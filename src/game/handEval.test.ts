import { describe, expect, it } from 'vitest'
import { Card } from './types'
import { compareHands, evaluateBest, handKoreanName } from './handEval'

// 카드 축약 표기: '14s' 대신 rank+suit 헬퍼로 가독성 있게
const c = (rank: number, suit: Card['suit']): Card => ({ rank, suit })

// A=14, K=13, Q=12, J=11, T=10

describe('족보 판정 (5장)', () => {
  it('로열 플러시', () => {
    const r = evaluateBest([c(10, 'h'), c(11, 'h'), c(12, 'h'), c(13, 'h'), c(14, 'h')])
    expect(r.category).toBe(8)
    expect(r.tiebreak[0]).toBe(14)
    expect(handKoreanName(r)).toBe('로열 플러시')
  })

  it('스트레이트 플러시 (9 하이)', () => {
    const r = evaluateBest([c(5, 's'), c(6, 's'), c(7, 's'), c(8, 's'), c(9, 's')])
    expect(r.category).toBe(8)
    expect(r.tiebreak[0]).toBe(9)
  })

  it('휠 스트레이트 플러시 (A-2-3-4-5)는 5 하이', () => {
    const r = evaluateBest([c(14, 'd'), c(2, 'd'), c(3, 'd'), c(4, 'd'), c(5, 'd')])
    expect(r.category).toBe(8)
    expect(r.tiebreak[0]).toBe(5)
  })

  it('포카드 — 키커까지 기록', () => {
    const r = evaluateBest([c(9, 's'), c(9, 'h'), c(9, 'd'), c(9, 'c'), c(13, 's')])
    expect(r.category).toBe(7)
    expect(r.tiebreak).toEqual([9, 13])
  })

  it('풀 하우스 — 트리플 우선', () => {
    const r = evaluateBest([c(12, 's'), c(12, 'h'), c(12, 'd'), c(7, 's'), c(7, 'h')])
    expect(r.category).toBe(6)
    expect(r.tiebreak).toEqual([12, 7])
  })

  it('플러시', () => {
    const r = evaluateBest([c(2, 'h'), c(6, 'h'), c(9, 'h'), c(11, 'h'), c(13, 'h')])
    expect(r.category).toBe(5)
    expect(r.tiebreak[0]).toBe(13)
  })

  it('스트레이트 (무늬 섞임)', () => {
    const r = evaluateBest([c(4, 's'), c(5, 'h'), c(6, 'd'), c(7, 'c'), c(8, 's')])
    expect(r.category).toBe(4)
    expect(r.tiebreak[0]).toBe(8)
  })

  it('휠 스트레이트 (A-2-3-4-5)는 5 하이', () => {
    const r = evaluateBest([c(14, 's'), c(2, 'h'), c(3, 'd'), c(4, 'c'), c(5, 's')])
    expect(r.category).toBe(4)
    expect(r.tiebreak[0]).toBe(5)
  })

  it('브로드웨이 (10-J-Q-K-A)는 A 하이 스트레이트', () => {
    const r = evaluateBest([c(10, 's'), c(11, 'h'), c(12, 'd'), c(13, 'c'), c(14, 's')])
    expect(r.category).toBe(4)
    expect(r.tiebreak[0]).toBe(14)
  })

  it('A-K-Q-J-9는 스트레이트가 아니다', () => {
    const r = evaluateBest([c(14, 's'), c(13, 'h'), c(12, 'd'), c(11, 'c'), c(9, 's')])
    expect(r.category).toBe(0)
  })

  it('K-A-2-3-4처럼 A를 감아 도는 스트레이트는 없다', () => {
    const r = evaluateBest([c(13, 's'), c(14, 'h'), c(2, 'd'), c(3, 'c'), c(4, 's')])
    expect(r.category).toBe(0)
  })

  it('트리플·투 페어·원 페어·하이 카드', () => {
    expect(evaluateBest([c(8, 's'), c(8, 'h'), c(8, 'd'), c(14, 's'), c(13, 'd')]).category).toBe(3)
    expect(evaluateBest([c(11, 's'), c(11, 'h'), c(4, 'd'), c(4, 'c'), c(14, 's')]).category).toBe(2)
    expect(evaluateBest([c(10, 's'), c(10, 'h'), c(14, 'd'), c(13, 'c'), c(3, 's')]).category).toBe(1)
    expect(evaluateBest([c(14, 's'), c(11, 'h'), c(8, 'd'), c(5, 'c'), c(2, 's')]).category).toBe(0)
  })
})

describe('족보 비교', () => {
  const beats = (a: Card[], b: Card[]) =>
    compareHands(evaluateBest(a), evaluateBest(b))

  it('같은 원 페어면 키커로 가른다', () => {
    const aceKicker = [c(10, 's'), c(10, 'h'), c(14, 'd'), c(7, 'c'), c(3, 's')]
    const kingKicker = [c(10, 'd'), c(10, 'c'), c(13, 'd'), c(7, 'h'), c(3, 'd')]
    expect(beats(aceKicker, kingKicker)).toBeGreaterThan(0)
  })

  it('투 페어는 높은 페어 → 낮은 페어 → 키커 순', () => {
    const acesAndTwos = [c(14, 's'), c(14, 'h'), c(2, 'd'), c(2, 'c'), c(5, 's')]
    const kingsAndQueens = [c(13, 's'), c(13, 'h'), c(12, 'd'), c(12, 'c'), c(14, 'c')]
    expect(beats(acesAndTwos, kingsAndQueens)).toBeGreaterThan(0)
  })

  it('휠은 6 하이 스트레이트보다 낮다', () => {
    const wheel = [c(14, 's'), c(2, 'h'), c(3, 'd'), c(4, 'c'), c(5, 's')]
    const sixHigh = [c(2, 's'), c(3, 'h'), c(4, 'd'), c(5, 'c'), c(6, 's')]
    expect(beats(sixHigh, wheel)).toBeGreaterThan(0)
  })

  it('플러시는 스트레이트를 이긴다', () => {
    const flush = [c(2, 'h'), c(6, 'h'), c(9, 'h'), c(11, 'h'), c(13, 'h')]
    const straight = [c(10, 's'), c(11, 'h'), c(12, 'd'), c(13, 'c'), c(14, 's')]
    expect(beats(flush, straight)).toBeGreaterThan(0)
  })

  it('풀 하우스는 트리플이 같으면 페어로 가른다', () => {
    const highPair = [c(9, 's'), c(9, 'h'), c(9, 'd'), c(14, 's'), c(14, 'h')]
    const lowPair = [c(9, 'c'), c(9, 's'), c(9, 'h'), c(2, 's'), c(2, 'h')]
    expect(beats(highPair, lowPair)).toBeGreaterThan(0)
  })

  it('완전히 같은 족보는 무승부(0)', () => {
    const a = [c(10, 's'), c(11, 'h'), c(12, 'd'), c(13, 'c'), c(14, 's')]
    const b = [c(10, 'h'), c(11, 'd'), c(12, 'c'), c(13, 's'), c(14, 'h')]
    expect(beats(a, b)).toBe(0)
  })
})

describe('7장 중 최고 5장 (evaluateBest)', () => {
  it('홀카드 페어 + 보드 페어 조합으로 투 페어를 찾는다', () => {
    const r = evaluateBest([
      c(9, 's'), c(9, 'h'), // 홀카드
      c(13, 'd'), c(13, 'c'), c(4, 's'), c(7, 'h'), c(2, 'd'), // 보드
    ])
    expect(r.category).toBe(2)
    expect(r.tiebreak.slice(0, 2)).toEqual([13, 9])
  })

  it('보드 플레이: 보드의 브로드웨이가 홀카드 페어보다 좋으면 보드로 친다', () => {
    const r = evaluateBest([
      c(2, 's'), c(2, 'h'),
      c(10, 'd'), c(11, 'c'), c(12, 's'), c(13, 'h'), c(14, 'd'),
    ])
    expect(r.category).toBe(4)
    expect(r.tiebreak[0]).toBe(14)
  })

  it('7장 안에 숨은 플러시를 찾는다 (스트레이트보다 우선)', () => {
    const r = evaluateBest([
      c(9, 'h'), c(2, 'h'),
      c(10, 's'), c(11, 'h'), c(12, 'd'), c(13, 'h'), c(5, 'h'),
    ])
    expect(r.category).toBe(5)
  })

  it('6장 입력도 처리한다', () => {
    const r = evaluateBest([
      c(9, 's'), c(9, 'h'), c(9, 'd'), c(4, 's'), c(4, 'h'), c(2, 'c'),
    ])
    expect(r.category).toBe(6)
    expect(r.tiebreak).toEqual([9, 4])
  })
})
