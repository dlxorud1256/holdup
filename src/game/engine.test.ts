import { describe, expect, it } from 'vitest'
import { Card } from './types'
import { Action, applyAction, GameState, newGame, potSize, rebuy, START_CHIPS, startHand } from './engine'

const c = (rank: number, suit: Card['suit']): Card => ({ rank, suit })

// 테이블 전체 칩 + 팟 합계 — 어떤 시점에도 불변이어야 한다 (칩 보존 법칙)
const totalChips = (s: GameState) => s.players.reduce((sum, p) => sum + p.chips, 0) + potSize(s)

// 딜러 위치를 고정해 좌석 순서를 결정적으로 만든다:
// startHand는 dealerIdx 다음 자리로 버튼을 옮기므로, 마지막 좌석으로 두면 0번이 딜러가 된다
function fixedHand(state: GameState): GameState {
  state.dealerIdx = state.players.length - 1
  return startHand(state)
}

// 덱과 홀카드를 통제해 쇼다운을 결정적으로 만든다.
// deck은 pop()으로 뒤에서부터 나가므로, 보드에 깔릴 순서의 역순으로 넣는다.
function rig(state: GameState, hands: Card[][], board: Card[]) {
  hands.forEach((h, i) => { state.players[i].cards = h })
  state.deck = [...board].reverse()
}

describe('블라인드와 기본 진행', () => {
  it('핸드 시작 시 블라인드가 걷혀 팟 150, 콜 기준 100', () => {
    const s = fixedHand(newGame('tournament', 3))
    expect(potSize(s)).toBe(150)
    expect(s.currentBet).toBe(100)
    expect(totalChips(s)).toBe(4 * START_CHIPS)
  })

  it('토너먼트는 7번째 핸드부터 블라인드 100/200으로 인상', () => {
    let s = fixedHand(newGame('tournament', 3))
    for (let i = 0; i < 6; i++) {
      while (s.phase === 'betting') s = applyAction(s, { type: 'fold' })
      s = startHand(s)
    }
    expect(s.handNumber).toBe(7)
    expect(s.sb).toBe(100)
    expect(s.bb).toBe(200)
  })

  it('캐시 게임은 블라인드가 오르지 않는다', () => {
    let s = fixedHand(newGame('cash', 3))
    for (let i = 0; i < 6; i++) {
      while (s.phase === 'betting') s = applyAction(s, { type: 'fold' })
      s = startHand(s)
    }
    expect(s.handNumber).toBe(7)
    expect(s.bb).toBe(100)
  })
})

describe('팟 정산', () => {
  it('전원 폴드하면 빅 블라인드가 팟을 가져간다', () => {
    // 좌석: 0=딜러, 1=SB, 2=BB, 3=UTG(첫 액션)
    let s = fixedHand(newGame('tournament', 3))
    while (s.phase === 'betting') s = applyAction(s, { type: 'fold' })
    expect(s.players[2].chips).toBe(START_CHIPS + 50) // BB가 SB 몫만큼 순이익
    expect(s.players[1].chips).toBe(START_CHIPS - 50)
    expect(s.handOver?.showdown).toBe(false)
    expect(totalChips(s)).toBe(4 * START_CHIPS)
  })

  it('헤즈업 쇼다운: AA가 KK를 이기고 팟을 가져간다', () => {
    // 헤즈업은 딜러가 SB: 0=딜러/SB, 1=BB
    let s = fixedHand(newGame('tournament', 1))
    rig(s, [[c(14, 's'), c(14, 'h')], [c(13, 's'), c(13, 'h')]],
      [c(2, 'c'), c(7, 'd'), c(8, 'h'), c(3, 's'), c(4, 'd')])
    s = applyAction(s, { type: 'call' }) // SB 콜
    s = applyAction(s, { type: 'check' }) // BB 체크 → 플랍
    for (let i = 0; i < 6; i++) s = applyAction(s, { type: 'check' }) // 플랍·턴·리버 체크
    expect(s.handOver?.showdown).toBe(true)
    expect(s.players[0].chips).toBe(START_CHIPS + 100)
    expect(s.players[1].chips).toBe(START_CHIPS - 100)
  })

  it('무승부: 보드 플레이면 팟을 정확히 반으로 나눈다', () => {
    let s = fixedHand(newGame('tournament', 1))
    rig(s, [[c(2, 'c'), c(3, 'c')], [c(2, 'd'), c(3, 'h')]],
      [c(10, 's'), c(11, 'h'), c(12, 'd'), c(13, 'c'), c(14, 'h')]) // 보드가 브로드웨이
    s = applyAction(s, { type: 'call' })
    s = applyAction(s, { type: 'check' })
    for (let i = 0; i < 6; i++) s = applyAction(s, { type: 'check' })
    expect(s.players[0].chips).toBe(START_CHIPS)
    expect(s.players[1].chips).toBe(START_CHIPS)
  })

  it('사이드팟: 숏스택은 메인 팟만, 커버한 쪽이 사이드 팟을 가져간다', () => {
    // 스택: 0=10000(KK), 1=SB 2000(AA), 2=BB 5000(QQ) — 전원 올인
    const g = newGame('tournament', 2)
    g.players[1].chips = 2000
    g.players[2].chips = 5000
    let s = fixedHand(g)
    rig(s, [
      [c(13, 's'), c(13, 'h')], // 0: KK
      [c(14, 's'), c(14, 'h')], // 1: AA (숏스택)
      [c(12, 's'), c(12, 'h')], // 2: QQ
    ], [c(2, 'c'), c(3, 'd'), c(7, 'c'), c(8, 'd'), c(11, 'c')])
    s = applyAction(s, { type: 'raise', to: 10000 }) // 0 올인
    s = applyAction(s, { type: 'call' }) // 1 올인 콜 (2000)
    s = applyAction(s, { type: 'call' }) // 2 올인 콜 (5000)
    // 메인 팟 6000(2000×3) → AA. 사이드 팟 6000(3000×2, 0·2만 참여) → KK. 남은 5000 → 0에게 반환
    expect(s.players[1].chips).toBe(6000)
    expect(s.players[0].chips).toBe(11000)
    expect(s.players[2].chips).toBe(0)
    expect(s.players[2].out).toBe(true)
    expect(totalChips(s)).toBe(17000)
  })

  it('캐시 게임: 파산한 봇 자리에 새 손님이 새 칩으로 앉는다', () => {
    let s = fixedHand(newGame('cash', 1))
    rig(s, [[c(14, 's'), c(14, 'h')], [c(13, 's'), c(13, 'h')]],
      [c(2, 'c'), c(7, 'd'), c(8, 'h'), c(3, 's'), c(4, 'd')])
    s = applyAction(s, { type: 'raise', to: START_CHIPS }) // 사람 올인
    s = applyAction(s, { type: 'call' }) // 봇 올인 콜 → AA 승, 봇 파산
    expect(s.players[1].out).toBe(true)
    const oldName = s.players[1].name
    s = startHand(s)
    expect(s.players[1].out).toBe(false)
    expect(s.players[1].name).not.toBe(oldName)
    // 새 손님은 새 칩을 들고 온다 (블라인드 낸 만큼만 차감된 상태)
    expect(s.players[1].chips + s.players[1].totalBet).toBe(START_CHIPS)
  })
})

describe('칩 보존 속성 테스트 (무작위 플레이)', () => {
  // 합법 액션 중 하나를 무작위로 고른다 — 이상한 사이징(미니 레이즈, 언더 올인)도 일부러 굴린다
  function randomAction(s: GameState): Action {
    const p = s.players[s.currentIdx]
    const toCall = Math.max(0, s.currentBet - p.bet)
    const r = Math.random()
    const wildRaise = (): Action =>
      ({ type: 'raise', to: p.bet + 1 + Math.floor(Math.random() * p.chips) })
    if (toCall === 0) return r < 0.65 ? { type: 'check' } : wildRaise()
    if (r < 0.4) return { type: 'fold' }
    if (r < 0.85) return { type: 'call' }
    return wildRaise()
  }

  it('토너먼트 500핸드: 어떤 액션 뒤에도 칩 총합이 변하지 않는다', () => {
    const TOTAL = 4 * START_CHIPS
    let s = startHand(newGame('tournament', 3))
    for (let hand = 0; hand < 500; hand++) {
      let guard = 0
      while (s.phase === 'betting') {
        const a = randomAction(s)
        s = applyAction(s, a)
        if (totalChips(s) !== TOTAL) {
          throw new Error(`칩 보존 위반: ${s.handNumber}번째 핸드, 액션 ${JSON.stringify(a)} 후 총합 ${totalChips(s)}`)
        }
        if (++guard > 500) throw new Error(`${s.handNumber}번째 핸드가 끝나지 않음 (무한 루프 의심)`)
      }
      s = s.phase === 'gameOver' ? startHand(newGame('tournament', 3)) : startHand(s)
    }
  })

  it('캐시 300핸드: 손님 교체·리바이가 있어도 핸드 안에서는 칩이 보존된다', () => {
    let s = startHand(newGame('cash', 3))
    for (let hand = 0; hand < 300; hand++) {
      const total = totalChips(s) // 손님 교체로 테이블 총액이 바뀔 수 있으니 핸드마다 기준을 다시 잡는다
      let guard = 0
      while (s.phase === 'betting') {
        s = applyAction(s, randomAction(s))
        if (totalChips(s) !== total) {
          throw new Error(`칩 보존 위반(캐시): ${s.handNumber}번째 핸드, 총합 ${totalChips(s)} ≠ ${total}`)
        }
        if (++guard > 500) throw new Error(`${s.handNumber}번째 핸드가 끝나지 않음`)
      }
      if (s.phase === 'gameOver') s = rebuy(s)
      s = startHand(s)
    }
  })
})
