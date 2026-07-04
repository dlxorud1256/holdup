import { Card } from './types'
import { rankName } from './deck'

// category: 0=하이카드 1=원페어 2=투페어 3=트리플 4=스트레이트
//           5=플러시 6=풀하우스 7=포카드 8=스트레이트플러시
export interface HandResult {
  category: number
  tiebreak: number[]
  cards: Card[] // 족보를 구성하는 5장 (하이라이트용)
}

export function compareHands(a: HandResult, b: HandResult): number {
  if (a.category !== b.category) return a.category - b.category
  const len = Math.max(a.tiebreak.length, b.tiebreak.length)
  for (let i = 0; i < len; i++) {
    const d = (a.tiebreak[i] ?? 0) - (b.tiebreak[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

function evaluate5(cards: Card[]): HandResult {
  const sorted = [...cards].sort((x, y) => y.rank - x.rank)
  const ranks = sorted.map(c => c.rank)
  const isFlush = cards.every(c => c.suit === cards[0].suit)

  const uniq = [...new Set(ranks)]
  let straightHigh = 0
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0]
    // A-2-3-4-5 (휠): [14,5,4,3,2]
    else if (uniq[0] === 14 && uniq[1] === 5) straightHigh = 5
  }

  const counts = new Map<number, number>()
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1)
  // [rank, count]를 count 내림차순 → rank 내림차순으로 정렬
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])

  const make = (category: number, tiebreak: number[]): HandResult => ({ category, tiebreak, cards })

  if (isFlush && straightHigh) return make(8, [straightHigh])
  if (groups[0][1] === 4) return make(7, [groups[0][0], groups[1][0]])
  if (groups[0][1] === 3 && groups[1][1] === 2) return make(6, [groups[0][0], groups[1][0]])
  if (isFlush) return make(5, ranks)
  if (straightHigh) return make(4, [straightHigh])
  if (groups[0][1] === 3) return make(3, [groups[0][0], ...ranks.filter(r => r !== groups[0][0])])
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    return make(2, [groups[0][0], groups[1][0], groups[2][0]])
  }
  if (groups[0][1] === 2) return make(1, [groups[0][0], ...ranks.filter(r => r !== groups[0][0])])
  return make(0, ranks)
}

// 5~7장 중 최고의 5장 조합을 찾는다
export function evaluateBest(cards: Card[]): HandResult {
  if (cards.length === 5) return evaluate5(cards)
  let best: HandResult | null = null
  const consider = (hand: Card[]) => {
    const r = evaluate5(hand)
    if (!best || compareHands(r, best) > 0) best = r
  }
  if (cards.length === 6) {
    for (let i = 0; i < cards.length; i++) consider(cards.filter((_, k) => k !== i))
  } else {
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        consider(cards.filter((_, k) => k !== i && k !== j))
      }
    }
  }
  return best!
}

export function handKoreanName(r: HandResult): string {
  const t = r.tiebreak
  switch (r.category) {
    case 8: return t[0] === 14 ? '로열 플러시' : `스트레이트 플러시 (${rankName(t[0])} 하이)`
    case 7: return `포카드 (${rankName(t[0])})`
    case 6: return `풀 하우스 (${rankName(t[0])} + ${rankName(t[1])})`
    case 5: return `플러시 (${rankName(t[0])} 하이)`
    case 4: return `스트레이트 (${rankName(t[0])} 하이)`
    case 3: return `트리플 (${rankName(t[0])})`
    case 2: return `투 페어 (${rankName(t[0])}·${rankName(t[1])})`
    case 1: return `원 페어 (${rankName(t[0])})`
    default: return `하이 카드 (${rankName(t[0])})`
  }
}

// 프리플랍(내 카드 2장만 있을 때)용 설명
export function describeHoleCards(cards: Card[]): string {
  if (cards.length < 2) return ''
  if (cards[0].rank === cards[1].rank) return `원 페어 (${rankName(cards[0].rank)})`
  const high = Math.max(cards[0].rank, cards[1].rank)
  return `하이 카드 (${rankName(high)})`
}
