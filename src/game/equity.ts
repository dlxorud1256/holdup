import { Card } from './types'
import { cardKey, newDeck } from './deck'
import { compareHands, evaluateBest } from './handEval'

// 몬테카를로 시뮬레이션으로 승률을 추정한다.
// 남은 카드 중에서 상대 패와 남은 공용 카드를 무작위로 깔아보는 것을
// iterations번 반복해, 이길 확률(무승부는 1/공동승자 수로 계산)을 구한다.
export function estimateEquity(
  hole: Card[],
  community: Card[],
  numOpponents: number,
  iterations = 300,
): number {
  if (numOpponents <= 0) return 1
  if (hole.length < 2) return 0

  const used = new Set([...hole, ...community].map(cardKey))
  const pool = newDeck().filter(c => !used.has(cardKey(c)))
  const need = numOpponents * 2 + (5 - community.length)

  let score = 0
  for (let it = 0; it < iterations; it++) {
    // 부분 피셔-예이츠: 필요한 장수만 pool 앞쪽으로 무작위 추출
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(Math.random() * (pool.length - i))
      ;[pool[i], pool[j]] = [pool[j], pool[i]]
    }
    let k = 0
    const board = [...community]
    while (board.length < 5) board.push(pool[k++])

    const mine = evaluateBest([...hole, ...board])
    let winners = 1
    let lost = false
    for (let o = 0; o < numOpponents; o++) {
      const opp = evaluateBest([pool[k], pool[k + 1], ...board])
      k += 2
      const cmp = compareHands(opp, mine)
      if (cmp > 0) {
        lost = true
        break
      }
      if (cmp === 0) winners++
    }
    if (!lost) score += 1 / winners
  }
  return score / iterations
}
