import { Card, Player } from './types'
import { Action, BIG_BLIND, GameState, potSize } from './engine'
import { evaluateBest, handKoreanName } from './handEval'

// 봇의 행동 결정 + 사람용 힌트에 함께 쓰인다
export interface Advice {
  action: Action
  reason: string
}

const round50 = (x: number) => Math.round(x / 50) * 50

function clampRaiseTo(state: GameState, p: Player, want: number): number {
  const maxTo = p.bet + p.chips
  const minTo = Math.min(state.currentBet + state.minRaise, maxTo)
  return Math.max(minTo, Math.min(maxTo, round50(want)))
}

// Chen 공식 기반 시작 패 점수 (대략 -1 ~ 20)
function chenScore(cards: Card[]): number {
  const [a, b] = [...cards].sort((x, y) => y.rank - x.rank)
  const pts = (r: number) => (r === 14 ? 10 : r === 13 ? 8 : r === 12 ? 7 : r === 11 ? 6 : r / 2)
  if (a.rank === b.rank) return Math.max(5, pts(a.rank) * 2)
  let score = pts(a.rank)
  if (a.suit === b.suit) score += 2
  const gap = a.rank - b.rank - 1
  score -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5
  if (gap <= 1 && a.rank < 12) score += 1
  return score
}

function hasFlushDraw(cards: Card[]): boolean {
  const counts: Record<string, number> = {}
  for (const c of cards) counts[c.suit] = (counts[c.suit] ?? 0) + 1
  return Object.values(counts).some(n => n === 4)
}

function hasStraightDraw(cards: Card[]): boolean {
  const ranks = new Set(cards.map(c => c.rank))
  for (let x = 2; x <= 11; x++) {
    if (ranks.has(x) && ranks.has(x + 1) && ranks.has(x + 2) && ranks.has(x + 3)) return true
  }
  return false
}

export function decide(state: GameState, p: Player): Advice {
  const toCall = Math.max(0, state.currentBet - p.bet)
  if (state.street === 'preflop') return decidePreflop(state, p, toCall)
  return decidePostflop(state, p, toCall)
}

function decidePreflop(state: GameState, p: Player, toCall: number): Advice {
  const score = chenScore(p.cards)
  const { tight, aggression } = p.personality
  const canRaise = p.bet + p.chips > state.currentBet
  const pot = potSize(state)

  if (toCall <= 0) {
    if (canRaise && (score >= 10 - aggression * 1.5 || Math.random() < aggression * 0.2)) {
      const to = clampRaiseTo(state, p, state.currentBet + pot * 0.75 + BIG_BLIND)
      return { action: { type: 'raise', to }, reason: '시작 패가 강한 편이에요. 레이즈로 주도권을 잡아보세요.' }
    }
    return { action: { type: 'check' }, reason: '공짜로 다음 카드를 볼 수 있어요. 체크!' }
  }

  if (canRaise && score >= 12 && Math.random() < 0.85) {
    const to = clampRaiseTo(state, p, Math.max(state.currentBet * 3, BIG_BLIND * 3))
    return { action: { type: 'raise', to }, reason: '프리미엄 시작 패예요! 강하게 레이즈해서 가치를 키우세요.' }
  }
  const unopened = state.currentBet === BIG_BLIND
  if (canRaise && unopened && score >= 8.5 && Math.random() < 0.5 + aggression * 0.3) {
    const to = clampRaiseTo(state, p, BIG_BLIND * 3.5)
    return { action: { type: 'raise', to }, reason: '괜찮은 시작 패예요. 먼저 레이즈해서 압박해볼 만해요.' }
  }

  const bigBet = toCall > p.chips * 0.35 || toCall > BIG_BLIND * 8
  const callNeed = (bigBet ? 10 : 6) + tight * 2 - aggression
  if (score >= callNeed) {
    return { action: { type: 'call' }, reason: '시작 패가 콜할 만큼은 좋아요.' }
  }
  if (toCall <= BIG_BLIND && score >= callNeed - 2) {
    return { action: { type: 'call' }, reason: '콜 비용이 싸니까 한번 볼 만해요.' }
  }
  return { action: { type: 'fold' }, reason: '시작 패가 약해요. 무리하지 말고 폴드하는 게 좋아요.' }
}

function decidePostflop(state: GameState, p: Player, toCall: number): Advice {
  const all = [...p.cards, ...state.community]
  const res = evaluateBest(all)
  const name = handKoreanName(res)
  const { tight, aggression } = p.personality
  const canRaise = p.bet + p.chips > state.currentBet
  const pot = potSize(state)

  let strength = [0.12, 0.35, 0.55, 0.68, 0.78, 0.85, 0.92, 0.97, 0.99][res.category]
  if (res.category === 1) {
    const boardTop = Math.max(...state.community.map(c => c.rank))
    if (res.tiebreak[0] >= boardTop) strength += 0.1 // 탑 페어 이상
    if (!p.cards.some(c => c.rank === res.tiebreak[0])) strength -= 0.15 // 보드 페어일 뿐
  }
  // 족보가 전부 공용 카드로만 만들어졌으면 할인
  const boardOnly = res.cards.every(c => state.community.some(b => b.rank === c.rank && b.suit === c.suit))
  if (boardOnly) strength -= 0.15

  let drawText = ''
  if (state.street !== 'river') {
    if (res.category < 5 && hasFlushDraw(all)) {
      strength += 0.12
      drawText = '플러시 드로우'
    } else if (res.category < 4 && hasStraightDraw(all)) {
      strength += 0.09
      drawText = '스트레이트 드로우'
    }
  }
  strength += (Math.random() - 0.5) * 0.06

  if (toCall <= 0) {
    const wantBet =
      strength > 0.72 ||
      (strength > 0.5 && Math.random() < 0.35 + aggression * 0.3) ||
      Math.random() < aggression * 0.12
    if (wantBet && canRaise) {
      const to = clampRaiseTo(state, p, state.currentBet + Math.max(BIG_BLIND, pot * (0.5 + aggression * 0.3)))
      return {
        action: { type: 'raise', to },
        reason: strength > 0.7 ? `${name} — 패가 강해요! 베팅으로 가치를 키우세요.` : '적당한 패지만 베팅으로 압박해볼 만해요.',
      }
    }
    return {
      action: { type: 'check' },
      reason: strength < 0.45 ? '패가 약하니 공짜로 넘어가요. 체크!' : '무리하지 않고 체크로 지켜봐요.',
    }
  }

  const potOdds = toCall / (pot + toCall)
  if (strength >= 0.85 && canRaise && Math.random() < 0.75) {
    const to = clampRaiseTo(state, p, state.currentBet + pot)
    return { action: { type: 'raise', to }, reason: `${name} — 아주 강한 패예요! 레이즈하세요.` }
  }
  const margin = 0.1 + (tight - 0.5) * 0.12
  if (strength >= potOdds + margin) {
    return {
      action: { type: 'call' },
      reason: drawText ? `${drawText}가 있어서 콜해볼 만해요.` : `${name} — 콜 비용 대비 나쁘지 않은 패예요.`,
    }
  }
  if (toCall <= pot * 0.15 && strength >= 0.3) {
    return { action: { type: 'call' }, reason: '콜 비용이 아주 싸서 한번 따라가볼 만해요.' }
  }
  if (canRaise && state.street !== 'river' && Math.random() < aggression * 0.06) {
    const to = clampRaiseTo(state, p, state.currentBet + pot * 0.8)
    return { action: { type: 'raise', to }, reason: '(블러핑) 가끔은 과감하게 상대를 밀어붙이는 것도 전략이에요.' }
  }
  return { action: { type: 'fold' }, reason: `${name}뿐이라 상대 베팅을 따라가기엔 약해요. 폴드가 안전합니다.` }
}
