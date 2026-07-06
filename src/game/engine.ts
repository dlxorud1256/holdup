import { BotStyle, Card, GameMode, HandRecord, LogEntry, ObservedStats, Phase, Player, Street } from './types'
import { cardText, newDeck, shuffle } from './deck'
import { compareHands, evaluateBest, handKoreanName, HandResult } from './handEval'

export const SMALL_BLIND = 50
export const BIG_BLIND = 100
export const START_CHIPS = 10000

// 토너먼트식 블라인드 스케줄: HANDS_PER_LEVEL 핸드마다 한 단계씩 인상
// → 게임이 갈수록 압박이 생기고 자연스러운 "끝"이 만들어진다
const BLIND_LEVELS: [number, number][] = [
  [50, 100], [100, 200], [150, 300], [200, 400],
  [300, 600], [400, 800], [600, 1200], [800, 1600], [1000, 2000],
]
const HANDS_PER_LEVEL = 6

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
  mode: GameMode
  players: Player[]
  deck: Card[]
  community: Card[]
  street: Street
  phase: Phase
  dealerIdx: number
  sbIdx: number
  bbIdx: number
  sb: number // 현재 스몰 블라인드 (핸드 수에 따라 인상)
  bb: number // 현재 빅 블라인드
  currentIdx: number
  currentBet: number // 이번 스트리트에서 맞춰야 할 금액
  minRaise: number
  needToAct: number[] // 이번 스트리트에서 아직 행동해야 하는 플레이어 id
  log: LogEntry[]
  handNumber: number
  actionSeq: number // 상태 변화마다 증가 (UI 타이머 동기화용)
  handOver: HandOverInfo | null
  gameResult: 'won' | 'lost' | null
  preflopRaiserId: number | null // 프리플랍 마지막 레이저 (봇의 컨티뉴에이션 벳 판단용)
  lastAggressorId: number | null // 이번 핸드에서 마지막으로 레이즈/벳한 플레이어
  aggressed: boolean[] // 이번 핸드에 각 플레이어가 공격적 액션(레이즈)을 했는지 (쇼다운 블러프 판정용)
  firstAggressionStreet: number[] // 각 플레이어가 처음 공격한 스트리트 index (-1 = 아직 없음) — 라인 읽기용
  bigBet: boolean[] // 이번 핸드에 포스트플랍 큰 베팅(팟 55%+)을 했는지 — 사이징 텔 채점용
  observed: ObservedStats[] // 플레이어별 관찰 통계 (index = player id)
  voluntary: boolean[] // 이번 핸드에 각 플레이어가 자발적으로 돈을 넣었는지
  history: HandRecord[] // 끝난 핸드들의 기록 (최근 50개)
  handStartChips: number // 이번 핸드 시작 시점의 내 칩 (순손익 계산용)
}

export const fmt = (n: number) => n.toLocaleString('ko-KR')

export const potSize = (state: GameState) => state.players.reduce((s, p) => s + p.totalBet, 0)

function addLog(state: GameState, text: string, kind: LogEntry['kind'] = 'action') {
  state.log.push({ text, kind })
  if (state.log.length > 300) state.log.splice(0, state.log.length - 300)
}

// 새 게임마다 이 풀에서 봇 수만큼 비밀리에 뽑아 배정한다
export const BOT_STYLE_POOL: BotStyle[] = ['lag', 'station', 'trapper', 'rock', 'balanced', 'gto']

// 캐시 게임에서 파산한 봇 자리에 앉는 새 손님들
const GUEST_POOL: [string, string][] = [
  ['초코', '🐶'], ['밀크', '🐰'], ['탄이', '🐧'], ['보리', '🦝'],
  ['콩이', '🐹'], ['두부', '🐨'], ['별이', '🦉'], ['망고', '🐵'],
]

// 오프타입 믹싱: 핸드의 12%는 자기 유형과 다른 스타일로 친다 (읽기를 확신으로 만들지 않기 위해)
const OFF_TYPE_RATE = 0.12

function offTypeStyle(base: BotStyle): BotStyle {
  const others = BOT_STYLE_POOL.filter(s => s !== base)
  return others[Math.floor(Math.random() * others.length)]
}

function emptyStats(): ObservedStats {
  return {
    handsDealt: 0, handsVoluntary: 0, facedBet: 0, foldToBet: 0,
    actions: 0, raises: 0, bigPreflopRaises: 0, showdowns: 0, bluffsShown: 0,
    bigBetsShown: 0, bigBetsValue: 0,
  }
}

function mkPlayer(id: number, name: string, avatar: string, isHuman: boolean): Player {
  return {
    id, name, avatar, isHuman,
    chips: START_CHIPS, cards: [], bet: 0, totalBet: 0,
    folded: false, allIn: false, out: false,
    lastAction: null, revealed: false,
    personality: { tight: 0.5, aggression: 0.5 },
    style: 'human', handStyle: 'human', intensity: 1,
    plan: null,
  }
}

// 시작 시 앉는 봇 라인업 (선택한 수만큼 앞에서부터)
const BOT_ROSTER: [string, string][] = [
  ['루비', '🦊'], ['포포', '🐻'], ['나비', '🐱'], ['초코', '🐶'], ['밀크', '🐰'],
]

export function newGame(mode: GameMode = 'tournament', botCount = 3): GameState {
  const n = Math.max(1, Math.min(BOT_ROSTER.length, botCount))
  const players = [
    mkPlayer(0, '나', '🙂', true),
    ...BOT_ROSTER.slice(0, n).map(([name, avatar], i) => mkPlayer(i + 1, name, avatar, false)),
  ]
  // 아키타입 비밀 셔플 + 게임별 강도 편차 (누가 어떤 유형인지는 UI 어디에도 노출하지 않는다)
  const stylePool = shuffle(BOT_STYLE_POOL).slice(0, players.length - 1)
  players.slice(1).forEach((p, i) => {
    p.style = stylePool[i]
    p.handStyle = stylePool[i]
    p.intensity = 0.85 + Math.random() * 0.3
    p.personality = { tight: 0.35 + Math.random() * 0.3, aggression: 0.35 + Math.random() * 0.3 }
  })
  return {
    mode,
    players,
    deck: [], community: [],
    street: 'preflop', phase: 'handOver',
    dealerIdx: Math.floor(Math.random() * players.length),
    sbIdx: 0, bbIdx: 0, sb: SMALL_BLIND, bb: BIG_BLIND, currentIdx: 0,
    currentBet: 0, minRaise: BIG_BLIND, needToAct: [],
    log: [{ text: '홀덤 연습장에 오신 걸 환영해요! 🎉', kind: 'info' }],
    handNumber: 0, actionSeq: 0,
    handOver: null, gameResult: null,
    preflopRaiserId: null,
    lastAggressorId: null,
    aggressed: players.map(() => false),
    firstAggressionStreet: players.map(() => -1),
    bigBet: players.map(() => false),
    observed: players.map(emptyStats),
    voluntary: players.map(() => false),
    history: [],
    handStartChips: START_CHIPS,
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
    p.plan = null
    // 오프타입 믹싱: 이번 핸드에 쓸 스타일을 굴린다 (핸드 내에서는 일관되게 유지)
    p.handStyle = p.isHuman || p.out || Math.random() >= OFF_TYPE_RATE ? p.style : offTypeStyle(p.style)
  }
  state.handStartChips = state.players.find(p => p.isHuman)?.chips ?? 0
  state.preflopRaiserId = null
  state.lastAggressorId = null
  state.aggressed = state.players.map(() => false)
  state.firstAggressionStreet = state.players.map(() => -1)
  state.bigBet = state.players.map(() => false)
  state.voluntary = state.players.map(() => false)
  const inGame = (p: Player) => !p.out
  state.dealerIdx = nextSeat(state, state.dealerIdx, inGame)
  for (let r = 0; r < 2; r++) {
    for (const p of state.players) if (!p.out) p.cards.push(state.deck.pop()!)
  }
  const numIn = state.players.filter(inGame).length
  // 헤즈업(2명)일 때는 딜러가 스몰 블라인드
  state.sbIdx = numIn === 2 ? state.dealerIdx : nextSeat(state, state.dealerIdx, inGame)
  state.bbIdx = nextSeat(state, state.sbIdx, inGame)

  // 블라인드 인상 체크 (캐시 게임은 항상 첫 레벨 고정)
  const level = state.mode === 'cash'
    ? 0
    : Math.min(BLIND_LEVELS.length - 1, Math.floor((state.handNumber - 1) / HANDS_PER_LEVEL))
  const [newSb, newBb] = BLIND_LEVELS[level]
  const blindsRaised = (state.bb ?? BIG_BLIND) < newBb
  state.sb = newSb
  state.bb = newBb

  // 캐시 게임: 파산한 봇 자리에 새 손님이 앉는다 (새 이름 + 새 비밀 유형 + 통계 리셋)
  if (state.mode === 'cash') {
    for (const p of state.players) {
      if (!p.isHuman && p.out) {
        const used = new Set(state.players.map(q => q.name))
        const candidates = GUEST_POOL.filter(([n]) => !used.has(n))
        const pool = candidates.length > 0 ? candidates : GUEST_POOL
        const [name, avatar] = pool[Math.floor(Math.random() * pool.length)]
        p.name = name
        p.avatar = avatar
        p.chips = START_CHIPS
        p.out = false
        p.style = BOT_STYLE_POOL[Math.floor(Math.random() * BOT_STYLE_POOL.length)]
        p.handStyle = p.style
        p.intensity = 0.85 + Math.random() * 0.3
        p.personality = { tight: 0.35 + Math.random() * 0.3, aggression: 0.35 + Math.random() * 0.3 }
        if (Array.isArray(state.observed)) state.observed[p.id] = emptyStats()
        addLog(state, `🚪 새 손님 ${name} ${avatar} 님이 앉았습니다`, 'info')
      }
    }
  }

  addLog(state, `───── ${state.handNumber}번째 핸드 ─────`, 'street')
  if (blindsRaised) addLog(state, `📈 블라인드 인상! 이제 ${fmt(newSb)}/${fmt(newBb)}`, 'win')
  const sb = state.players[state.sbIdx]
  const bb = state.players[state.bbIdx]
  addLog(state, `${sb.name}: 스몰 블라인드 ${fmt(payChips(sb, state.sb))}`, 'info')
  addLog(state, `${bb.name}: 빅 블라인드 ${fmt(payChips(bb, state.bb))}`, 'info')

  state.street = 'preflop'
  state.phase = 'betting'
  state.currentBet = state.bb
  state.minRaise = state.bb
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
  const potBefore = potSize(state) // 사이징 텔 채점용: 이 액션 전의 팟

  // 전원 성향 관찰 — 사람 통계는 봇 적응에, 봇 통계는 코치·플레이어의 유형 추리에 쓰인다
  if (Array.isArray(state.observed) && state.observed[p.id]) {
    const s = state.observed[p.id]
    s.actions++
    if (action.type === 'raise') s.raises++
    if (toCall > 0) {
      s.facedBet++
      if (action.type === 'fold') s.foldToBet++
    }
    if (state.street === 'preflop' && (action.type === 'call' || action.type === 'raise')) {
      state.voluntary[p.id] = true
    }
  }

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
        state.lastAggressorId = p.id
        if (Array.isArray(state.aggressed)) state.aggressed[p.id] = true
        if (Array.isArray(state.firstAggressionStreet) && state.firstAggressionStreet[p.id] === -1) {
          state.firstAggressionStreet[p.id] = STREET_ORDER.indexOf(state.street)
        }
        // 포스트플랍 큰 베팅(팟 55%+) 기록 — 쇼다운에서 진짜였는지 채점된다
        if (state.street !== 'preflop' && raiseBy >= potBefore * 0.55 && Array.isArray(state.bigBet)) {
          state.bigBet[p.id] = true
        }
        if (state.street === 'preflop') {
          state.preflopRaiserId = p.id
          // 올인급 초대형 레이즈 기록 (봇들의 응징형 적응에 사용)
          if ((p.allIn || to >= (state.bb ?? BIG_BLIND) * 25) && Array.isArray(state.observed) && state.observed[p.id]) {
            state.observed[p.id].bigPreflopRaises = (state.observed[p.id].bigPreflopRaises ?? 0) + 1
          }
        }
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
  state.minRaise = state.bb ?? BIG_BLIND
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

  // 쇼다운 기억: 공격적으로 베팅했는데 약한 패가 드러나면 "들킨 블러프"로 기록
  // → 이후 봇들이 그 플레이어의 베팅을 덜 믿는다
  if (Array.isArray(state.observed)) {
    for (const q of alive) {
      const s = state.observed[q.id]
      if (!s) continue
      s.showdowns = (s.showdowns ?? 0) + 1
      const res = results.get(q.id)!
      const won = winnings.has(q.id)
      if (state.aggressed?.[q.id] && (res.category === 0 || (res.category === 1 && !won))) {
        s.bluffsShown = (s.bluffsShown ?? 0) + 1
      }
      // 사이징 텔 채점: 이번 핸드에 큰 베팅을 했다면, 그게 진짜(투페어+ 또는 승리)였는지 기록
      if (state.bigBet?.[q.id]) {
        s.bigBetsShown = (s.bigBetsShown ?? 0) + 1
        if (res.category >= 2 || won) s.bigBetsValue = (s.bigBetsValue ?? 0) + 1
      }
    }
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

// 훔쳐보기(연습용 특권): 핸드 종료 후 숨겨진 패를 공개하고 남은 보드를 마저 깔아
// "만약 끝까지 갔다면 누가 이겼을까"를 보여준다 (래빗 헌팅).
// 실전에는 없는 정보이므로 봇들의 관찰 통계에는 일절 반영하지 않는다.
export function peek(state: GameState): GameState {
  if (state.phase !== 'handOver' && state.phase !== 'gameOver') return state
  const wasIncomplete = state.community.length < 5
  while (state.community.length < 5 && state.deck.length > 0) {
    state.community.push(state.deck.pop()!)
  }
  for (const p of state.players) {
    if (p.cards.length === 2) p.revealed = true
  }
  const dealt = state.players.filter(p => p.cards.length === 2)
  if (dealt.length > 0 && state.community.length === 5) {
    let best: Player[] = []
    let bestRes: HandResult | null = null
    for (const q of dealt) {
      const res = evaluateBest([...q.cards, ...state.community])
      if (!bestRes || compareHands(res, bestRes) > 0) {
        bestRes = res
        best = [q]
      } else if (compareHands(res, bestRes) === 0) {
        best.push(q)
      }
    }
    const names = best.map(b => b.name).join(', ')
    const peekText =
      `🫣 훔쳐보기${wasIncomplete ? ' (남은 보드까지 공개)' : ''}: 끝까지 갔다면 ${names} — ${handKoreanName(bestRes!)} 승리`
    addLog(state, peekText, 'info')
    // 히스토리 기록에도 훔쳐본 내용을 반영
    const rec = Array.isArray(state.history) ? state.history[state.history.length - 1] : null
    if (rec && rec.handNumber === state.handNumber) {
      rec.board = state.community.map(cardText).join(' ')
      rec.lines.push(peekText)
    }
  }
  state.actionSeq++
  return state
}

// 캐시 게임 리바이: 파산한 사람이 칩을 다시 충전하고 게임을 계속한다
export function rebuy(state: GameState): GameState {
  const human = state.players.find(p => p.isHuman)!
  human.chips = START_CHIPS
  human.out = false
  state.gameResult = null
  state.phase = 'handOver'
  addLog(state, `💳 리바이! ${fmt(START_CHIPS)} 충전`, 'win')
  state.actionSeq++
  return state
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
  if (Array.isArray(state.observed)) {
    for (const p of state.players) {
      if (p.cards.length === 2 && state.observed[p.id]) {
        state.observed[p.id].handsDealt++
        if (state.voluntary[p.id]) state.observed[p.id].handsVoluntary++
      }
    }
  }
  const human = state.players.find(p => p.isHuman)!

  // 핸드 히스토리 기록 (히스토리 뷰어용)
  if (Array.isArray(state.history)) {
    let start = 0
    state.log.forEach((l, i) => {
      if (l.text.startsWith('─────')) start = i
    })
    const winnersText = state.handOver
      ? state.handOver.winners
          .map(w => `${w.name} +${fmt(w.amount)}${w.handName ? ` (${w.handName})` : ''}`)
          .join(', ')
      : ''
    state.history.push({
      handNumber: state.handNumber,
      myCards: human.cards.map(cardText).join(' '),
      board: state.community.map(cardText).join(' '),
      lines: state.log.slice(start).map(l => l.text),
      winners: winnersText,
      myNet: human.chips - (state.handStartChips ?? human.chips),
      myFolded: human.folded,
    })
    if (state.history.length > 50) state.history.splice(0, state.history.length - 50)
  }

  const botsLeft = state.players.filter(p => !p.isHuman && !p.out).length
  if (human.out) {
    state.phase = 'gameOver'
    state.gameResult = 'lost'
    addLog(state, state.mode === 'cash' ? '칩이 다 떨어졌어요 — 리바이할 수 있어요!' : '게임 오버… 다시 도전해봐요!', 'info')
  } else if (botsLeft === 0 && state.mode !== 'cash') {
    // 캐시 게임에선 승리 조건 없음 — 다음 핸드에 새 손님이 앉는다
    state.phase = 'gameOver'
    state.gameResult = 'won'
    addLog(state, '모든 상대를 물리쳤어요! 축하합니다 🎉', 'win')
  } else {
    state.phase = 'handOver'
  }
  state.actionSeq++
}
