import { Card, LogEntry, Phase, Player, Street } from './types'
import { cardText, newDeck, shuffle } from './deck'
import { compareHands, evaluateBest, handKoreanName, HandResult } from './handEval'

export const SMALL_BLIND = 50
export const BIG_BLIND = 100
export const START_CHIPS = 10000

export type Action =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'raise'; to: number } // to = 이번 스트리트 베팅 총액 목표

export interface WinnerInfo {
  name: string
  avatar: string
  amount: number
  handName: string | null
}

export interface HandOverInfo {
  winners: WinnerInfo[]
  showdown: boolean
}

export interface GameState {
  players: Player[]
  deck: Card[]
  community: Card[]
  street: Street
  phase: Phase
  dealerIdx: number
  sbIdx: number
  bbIdx: number
  currentIdx: number
  currentBet: number // 이번 스트리트에서 맞춰야 할 금액
  minRaise: number
  needToAct: number[] // 이번 스트리트에서 아직 행동해야 하는 플레이어 id
  log: LogEntry[]
  handNumber: number
  actionSeq: number // 상태 변화마다 증가 (UI 타이머 동기화용)
  handOver: HandOverInfo | null
  gameResult: 'won' | 'lost' | null
}

export const fmt = (n: number) => n.toLocaleString('ko-KR')

export const potSize = (state: GameState) => state.players.reduce((s, p) => s + p.totalBet, 0)

function addLog(state: GameState, text: string, kind: LogEntry['kind'] = 'action') {
  state.log.push({ text, kind })
  if (state.log.length > 300) state.log.splice(0, state.log.length - 300)
}

function mkPlayer(
  id: number, name: string, avatar: string, isHuman: boolean,
  tight: number, aggression: number,
): Player {
  return {
    id, name, avatar, isHuman,
    chips: START_CHIPS, cards: [], bet: 0, totalBet: 0,
    folded: false, allIn: false, out: false,
    lastAction: null, revealed: false,
    personality: { tight, aggression },
  }
}

export function newGame(): GameState {
  const players = [
    mkPlayer(0, '나', '🙂', true, 0.5, 0.5),
    mkPlayer(1, '루비', '🦊', false, 0.35, 0.75),
    mkPlayer(2, '포포', '🐻', false, 0.7, 0.35),
    mkPlayer(3, '나비', '🐱', false, 0.45, 0.55),
  ]
  return {
    players,
    deck: [], community: [],
    street: 'preflop', phase: 'handOver',
    dealerIdx: Math.floor(Math.random() * players.length),
    sbIdx: 0, bbIdx: 0, currentIdx: 0,
    currentBet: 0, minRaise: BIG_BLIND, needToAct: [],
    log: [{ text: '홀덤 연습장에 오신 걸 환영해요! 🎉', kind: 'info' }],
    handNumber: 0, actionSeq: 0,
    handOver: null, gameResult: null,
  }
}

function nextSeat(state: GameState, from: number, pred: (p: Player) => boolean): number {
  const n = state.players.length
  for (let i = 1; i <= n; i++) {
    const idx = (from + i) % n
    if (pred(state.players[idx])) return idx
  }
  return -1
}

function payChips(p: Player, amount: number): number {
  const pay = Math.min(amount, p.chips)
  p.chips -= pay
  p.bet += pay
  p.totalBet += pay
  if (p.chips === 0) p.allIn = true
  return pay
}

export function startHand(state: GameState): GameState {
  state.handNumber++
  state.handOver = null
  state.community = []
  state.deck = shuffle(newDeck())
  for (const p of state.players) {
    p.cards = []
    p.bet = 0
    p.totalBet = 0
    p.lastAction = null
    p.revealed = false
    p.folded = p.out
    p.allIn = false
  }
  const inGame = (p: Player) => !p.out
  state.dealerIdx = nextSeat(state, state.dealerIdx, inGame)
  for (let r = 0; r < 2; r++) {
    for (const p of state.players) if (!p.out) p.cards.push(state.deck.pop()!)
  }
  const numIn = state.players.filter(inGame).length
  // 헤즈업(2명)일 때는 딜러가 스몰 블라인드
  state.sbIdx = numIn === 2 ? state.dealerIdx : nextSeat(state, state.dealerIdx, inGame)
  state.bbIdx = nextSeat(state, state.sbIdx, inGame)

  addLog(state, `───── ${state.handNumber}번째 핸드 ─────`, 'street')
  const sb = state.players[state.sbIdx]
  const bb = state.players[state.bbIdx]
  addLog(state, `${sb.name}: 스몰 블라인드 ${fmt(payChips(sb, SMALL_BLIND))}`, 'info')
  addLog(state, `${bb.name}: 빅 블라인드 ${fmt(payChips(bb, BIG_BLIND))}`, 'info')

  state.street = 'preflop'
  state.phase = 'betting'
  state.currentBet = BIG_BLIND
  state.minRaise = BIG_BLIND
  state.needToAct = state.players.filter(p => !p.out && !p.allIn).map(p => p.id)
  state.actionSeq++
  if (state.needToAct.length === 0) {
    finishBetting(state)
    return state
  }
  state.currentIdx = nextSeat(state, state.bbIdx, p => state.needToAct.includes(p.id))
  return state
}

export function applyAction(state: GameState, action: Action): GameState {
  if (state.phase !== 'betting') return state
  const p = state.players[state.currentIdx]
  const toCall = Math.max(0, state.currentBet - p.bet)

  switch (action.type) {
    case 'fold': {
      p.folded = true
      p.lastAction = '폴드 🙅'
      addLog(state, `${p.name}: 폴드`)
      break
    }
    case 'check': {
      p.lastAction = '체크 ✋'
      addLog(state, `${p.name}: 체크`)
      break
    }
    case 'call': {
      const pay = payChips(p, toCall)
      p.lastAction = p.allIn ? '올인 콜 💥' : `콜 ${fmt(pay)}`
      addLog(state, `${p.name}: ${p.allIn ? '올인 ' : ''}콜 ${fmt(pay)}`)
      break
    }
    case 'raise': {
      const maxTo = p.bet + p.chips
      let to = Math.min(action.to, maxTo)
      const minTo = state.currentBet + state.minRaise
      if (to < minTo && to < maxTo) to = Math.min(minTo, maxTo)
      const isOpen = state.currentBet === 0
      payChips(p, to - p.bet)
      const raiseBy = to - state.currentBet
      if (raiseBy > 0) {
        if (raiseBy >= state.minRaise) state.minRaise = raiseBy
        state.currentBet = to
        // 레이즈가 나오면 남은 전원이 다시 행동해야 한다
        state.needToAct = state.players
          .filter(q => q.id !== p.id && !q.out && !q.folded && !q.allIn)
          .map(q => q.id)
      }
      p.lastAction = p.allIn ? '올인 💥' : isOpen ? `벳 ${fmt(to)}` : `레이즈 ${fmt(to)}`
      addLog(state, `${p.name}: ${p.allIn ? `올인 (${fmt(to)})` : isOpen ? `벳 ${fmt(to)}` : `레이즈 → ${fmt(to)}`}`)
      break
    }
  }

  state.needToAct = state.needToAct.filter(id => id !== p.id)
  state.actionSeq++
  afterAction(state)
  return state
}

function afterAction(state: GameState) {
  const alive = state.players.filter(q => !q.out && !q.folded)
  if (alive.length === 1) {
    awardUncontested(state, alive[0])
    return
  }
  if (state.needToAct.length === 0) {
    finishBetting(state)
    return
  }
  state.currentIdx = nextSeat(state, state.currentIdx, q => state.needToAct.includes(q.id))
}

const STREET_ORDER: Street[] = ['preflop', 'flop', 'turn', 'river']
const STREET_KO: Record<Street, string> = { preflop: '프리플랍', flop: '플랍', turn: '턴', river: '리버' }

function finishBetting(state: GameState) {
  const alive = state.players.filter(q => !q.out && !q.folded)
  const canAct = alive.filter(q => !q.allIn)

  // 리버가 끝났거나, 베팅 가능한 사람이 1명 이하(전원 올인)면 보드를 끝까지 깔고 쇼다운
  if (state.street === 'river' || canAct.length <= 1) {
    if (state.community.length < 5) {
      while (state.community.length < 5) state.community.push(state.deck.pop()!)
      addLog(state, `남은 공용 카드 공개: ${state.community.map(cardText).join(' ')}`, 'street')
    }
    showdown(state)
    return
  }

  for (const q of state.players) {
    q.bet = 0
    if (!q.folded) q.lastAction = null
  }
  state.currentBet = 0
  state.minRaise = BIG_BLIND
  state.street = STREET_ORDER[STREET_ORDER.indexOf(state.street) + 1]
  const count = state.street === 'flop' ? 3 : 1
  for (let i = 0; i < count; i++) state.community.push(state.deck.pop()!)
  addLog(state, `[${STREET_KO[state.street]}] ${state.community.map(cardText).join(' ')}`, 'street')
  state.needToAct = canAct.map(q => q.id)
  state.currentIdx = nextSeat(state, state.dealerIdx, q => state.needToAct.includes(q.id))
  state.actionSeq++
}

function awardUncontested(state: GameState, winner: Player) {
  const amount = potSize(state)
  winner.chips += amount
  addLog(state, `${winner.name}: 모두 폴드! 팟 ${fmt(amount)} 획득 🏆`, 'win')
  state.handOver = {
    winners: [{ name: winner.name, avatar: winner.avatar, amount, handName: null }],
    showdown: false,
  }
  endHand(state)
}

function showdown(state: GameState) {
  const alive = state.players.filter(q => !q.out && !q.folded)
  const results = new Map<number, HandResult>()
  for (const q of alive) {
    q.revealed = true
    const r = evaluateBest([...q.cards, ...state.community])
    results.set(q.id, r)
    addLog(state, `${q.name}: ${q.cards.map(cardText).join(' ')} → ${handKoreanName(r)}`, 'info')
  }

  // 사이드팟: 총 기여액이 낮은 순으로 층을 나눠 분배
  const remaining = state.players.filter(q => q.totalBet > 0).map(q => ({ p: q, amt: q.totalBet }))
  const winnings = new Map<number, number>()
  for (;;) {
    const inPlay = remaining.filter(r => r.amt > 0)
    if (inPlay.length === 0) break
    const level = Math.min(...inPlay.map(r => r.amt))
    let amount = 0
    for (const r of inPlay) {
      amount += level
      r.amt -= level
    }
    const eligible = inPlay.map(r => r.p).filter(q => !q.folded && !q.out)
    if (eligible.length === 0) continue
    let winners = [eligible[0]]
    for (const q of eligible.slice(1)) {
      const cmp = compareHands(results.get(q.id)!, results.get(winners[0].id)!)
      if (cmp > 0) winners = [q]
      else if (cmp === 0) winners.push(q)
    }
    const share = Math.floor(amount / winners.length)
    const leftover = amount - share * winners.length
    winners.forEach((w, i) => {
      const got = share + (i === 0 ? leftover : 0)
      w.chips += got
      winnings.set(w.id, (winnings.get(w.id) ?? 0) + got)
    })
  }

  const winList: WinnerInfo[] = [...winnings.entries()]
    .map(([id, amount]) => {
      const q = state.players[id]
      return { name: q.name, avatar: q.avatar, amount, handName: handKoreanName(results.get(id)!) }
    })
    .sort((a, b) => b.amount - a.amount)
  for (const w of winList) addLog(state, `${w.name}: ${w.handName} → ${fmt(w.amount)} 획득! 🏆`, 'win')

  state.handOver = { winners: winList, showdown: true }
  endHand(state)
}

function endHand(state: GameState) {
  for (const p of state.players) {
    p.bet = 0
    p.totalBet = 0
    if (!p.out && p.chips === 0) {
      p.out = true
      addLog(state, `${p.name}: 칩이 없어 탈락했어요 😵`, 'info')
    }
  }
  const human = state.players.find(p => p.isHuman)!
  const botsLeft = state.players.filter(p => !p.isHuman && !p.out).length
  if (human.out) {
    state.phase = 'gameOver'
    state.gameResult = 'lost'
    addLog(state, '게임 오버… 다시 도전해봐요!', 'info')
  } else if (botsLeft === 0) {
    state.phase = 'gameOver'
    state.gameResult = 'won'
    addLog(state, '모든 상대를 물리쳤어요! 축하합니다 🎉', 'win')
  } else {
    state.phase = 'handOver'
  }
  state.actionSeq++
}
