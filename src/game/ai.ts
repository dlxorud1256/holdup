import { Player } from './types'
import { Action, BIG_BLIND, GameState, potSize } from './engine'
import { evaluateBest, handKoreanName } from './handEval'
import { estimateEquity } from './equity'

// 봇 AI: 몬테카를로 승률 계산(눈)은 공유하되, 그 위의 전략 층은 아키타입별로 다르다.
// 아키타입은 새 게임마다 봇들에게 비밀리에 섞여 배정되고(engine.newGame),
// 핸드의 12%는 자기 유형과 다르게 쳐서(오프타입 믹싱) 읽기가 확신이 되지 않게 한다.
// - lag: 매니악 — 컨티뉴에이션 벳, 블러프 레이즈, 오버베팅으로 압박
// - station: 콜링 스테이션 — 팟 오즈 무시하고 웬만하면 콜, 블러핑 안 통함
// - trapper: 함정형 — 강한 패는 숨기고(체크/콜) 다음 스트리트에 터뜨림
// - rock: 바위 — 프리미엄만 치는 초타이트, 베팅하면 거의 진짜
// - balanced/human: 균형형 — 교과서적 판단 (사람용 힌트/코치에도 사용)
export interface Advice {
  action: Action
  reason: string
  equity: number // 0~1 승률 추정치
}

export const BOT_ITERATIONS = 300

const round50 = (x: number) => Math.round(x / 50) * 50

function clampRaiseTo(state: GameState, p: Player, want: number): number {
  const maxTo = p.bet + p.chips
  const minTo = Math.min(state.currentBet + state.minRaise, maxTo)
  return Math.max(minTo, Math.min(maxTo, round50(want)))
}

// 봇들이 사람 플레이어를 읽은 결과.
// bluffFactor: 사람이 베팅 앞에서 잘 접을수록 1보다 커짐 → 블러핑 빈도 증가
// callFactor: 사람이 잘 받아줄수록 1보다 커짐 → 더 얇은 패로도 밸류 베팅
function readsOf(state: GameState): { bluffFactor: number; callFactor: number } {
  const o = Array.isArray(state.observed) ? state.observed[0] : null
  const human = state.players[0]
  const humanIn = human && !human.folded && !human.out
  if (!o || !humanIn || o.facedBet < 6) return { bluffFactor: 1, callFactor: 1 }
  const foldRate = o.foldToBet / o.facedBet
  return {
    bluffFactor: Math.max(0.4, Math.min(2, foldRate * 2.2)),
    callFactor: Math.max(0.7, Math.min(1.5, (1 - foldRate) * 2.2)),
  }
}

interface Ctx {
  equity: number
  pot: number
  toCall: number
  potOdds: number
  fairShare: number // n명 중 1명 = 1/n (승률 기준선)
  edge: number
  canRaise: boolean
  pct: number
  label: string
  isPreflop: boolean
  bluffFactor: number
  callFactor: number
  facingShove: boolean // 스택의 40% 이상을 요구하는 올인급 베팅에 직면
  callEquity: number // 올인 콜 판단용: 큰돈을 넣은 상대만 기준으로 한 승률 (사실상 1:1)
  shoveDiscount: number // 사람이 프리플랍 올인을 남발하면 콜 기준이 내려간다 (응징)
}

function buildCtx(state: GameState, p: Player): Ctx {
  const opponents = state.players.filter(q => q.id !== p.id && !q.out && !q.folded).length
  const equity = estimateEquity(p.cards, state.community, opponents, BOT_ITERATIONS)
  const toCall = Math.max(0, state.currentBet - p.bet)
  const pot = potSize(state)
  const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0
  const fairShare = 1 / (opponents + 1)
  const pct = Math.round(equity * 100)
  const handName = state.community.length >= 3
    ? handKoreanName(evaluateBest([...p.cards, ...state.community]))
    : null
  const { bluffFactor, callFactor } = readsOf(state)

  // 올인급 베팅 직면: 콜은 사실상 "큰돈을 넣은 상대"와의 승부이므로,
  // 아직 액션 전인(대부분 폴드할) 플레이어까지 포함한 멀티웨이 승률 대신
  // 이미 큰 베팅을 매치한 상대 수 기준으로 승률을 다시 계산한다
  const facingShove = toCall > 0 && toCall >= p.chips * 0.4
  let callEquity = equity
  if (facingShove) {
    const committed = state.players.filter(
      q => q.id !== p.id && !q.out && !q.folded && q.bet >= state.currentBet * 0.85,
    ).length
    callEquity = estimateEquity(p.cards, state.community, Math.max(1, committed), BOT_ITERATIONS)
  }

  // 사람이 프리플랍 올인급 레이즈를 반복하면 봇들의 콜 기준이 점점 내려간다
  const humanShoves = Array.isArray(state.observed) ? (state.observed[0]?.bigPreflopRaises ?? 0) : 0
  const shoveDiscount =
    !p.isHuman && state.street === 'preflop' && state.preflopRaiserId === 0
      ? Math.min(0.15, Math.max(0, humanShoves - 1) * 0.04)
      : 0

  return {
    equity, pot, toCall, potOdds, fairShare,
    edge: equity - fairShare,
    canRaise: p.bet + p.chips > state.currentBet,
    pct,
    label: handName ? `${handName}, 승률 약 ${pct}%` : `승률 약 ${pct}%`,
    isPreflop: state.street === 'preflop',
    bluffFactor, callFactor,
    facingShove, callEquity, shoveDiscount,
  }
}

// 올인급 베팅에 대한 공통 콜/폴드 판단 (봇용).
// 1:1 승률(callEquity)이 기준을 넘으면 콜 — 기준은 아키타입별로 다르고,
// 사람이 올인을 남발할수록(shoveDiscount) 내려가되 팟 오즈 아래로는 안 내려간다.
function decideVsShove(c: Ctx, baseThresh: number): Advice | null {
  if (!c.facingShove) return null
  const thresh = Math.max(c.potOdds + 0.02, baseThresh - c.shoveDiscount)
  const pctHu = Math.round(c.callEquity * 100)
  if (c.callEquity >= thresh) {
    return { action: { type: 'call' }, reason: `올인 콜 — 1:1 승률 약 ${pctHu}%`, equity: c.callEquity }
  }
  return { action: { type: 'fold' }, reason: `올인 폴드 — 1:1 승률 ${pctHu}%로는 부족`, equity: c.callEquity }
}

export function decide(state: GameState, p: Player): Advice {
  const ctx = buildCtx(state, p)
  const style = p.isHuman ? 'human' : (p.handStyle ?? p.style)
  switch (style) {
    case 'lag': return decideLag(state, p, ctx)
    case 'station': return decideStation(state, p, ctx)
    case 'trapper': return decideTrapper(state, p, ctx)
    case 'rock': return decideRock(state, p, ctx)
    default: return decideBalanced(state, p, ctx)
  }
}

// ───────── 루비 🦊: 매니악 (loose-aggressive) ─────────
function decideLag(state: GameState, p: Player, c: Ctx): Advice {
  const advise = (action: Action, reason: string): Advice => ({ action, reason, equity: c.equity })
  const r = Math.random()

  if (c.isPreflop) {
    if (c.toCall <= 0) {
      if (c.canRaise && (c.equity > c.fairShare * 0.9 || r < 0.35 * p.intensity)) {
        return advise({ type: 'raise', to: clampRaiseTo(state, p, BIG_BLIND * 3.5) }, '압박 오픈 레이즈')
      }
      return advise({ type: 'check' }, '체크')
    }
    const vsShove = decideVsShove(c, 0.56)
    if (vsShove) return vsShove
    const unopened = state.currentBet === BIG_BLIND
    if (c.canRaise && c.equity > c.fairShare * 1.5 && r < 0.75) {
      return advise(
        { type: 'raise', to: clampRaiseTo(state, p, Math.max(state.currentBet * 3, BIG_BLIND * 4)) },
        '강한 패 — 크게 압박',
      )
    }
    if (c.canRaise && unopened && (c.equity > c.fairShare * 0.8 || r < 0.3 * c.bluffFactor * p.intensity)) {
      return advise({ type: 'raise', to: clampRaiseTo(state, p, BIG_BLIND * 3.5) }, '넓은 오픈 레이즈')
    }
    if (c.canRaise && !unopened && r < 0.1 * c.bluffFactor * p.intensity && c.toCall < p.chips * 0.25) {
      return advise({ type: 'raise', to: clampRaiseTo(state, p, state.currentBet * 2.8) }, '3벳 블러프')
    }
    if (c.equity >= c.potOdds * 0.9 && c.toCall < p.chips * 0.5) return advise({ type: 'call' }, '루즈 콜')
    if (c.toCall <= BIG_BLIND * 2 && c.equity > c.fairShare * 0.6) return advise({ type: 'call' }, '싸니까 콜')
    return advise({ type: 'fold' }, '이번엔 접기')
  }

  // 포스트플랍: 상대가 잘 받아줄수록 더 얇은 패로도 밸류 베팅
  const valueThresh = 0.68 - (c.callFactor - 1) * 0.12
  if (c.toCall <= 0) {
    if (c.canRaise && c.equity >= valueThresh) {
      const size = r < 0.22 ? c.pot * 1.3 : c.pot * (0.6 + Math.random() * 0.4) // 가끔 오버베팅
      return advise({ type: 'raise', to: clampRaiseTo(state, p, state.currentBet + size) }, '밸류 베팅')
    }
    const cbetSpot = state.preflopRaiserId === p.id && state.street === 'flop'
    if (c.canRaise && cbetSpot && r < Math.min(0.85, 0.75 * c.bluffFactor * p.intensity)) {
      return advise({ type: 'raise', to: clampRaiseTo(state, p, c.pot * 0.6) }, '컨티뉴에이션 벳')
    }
    if (c.canRaise && r < 0.25 * c.bluffFactor * p.intensity) {
      return advise({ type: 'raise', to: clampRaiseTo(state, p, c.pot * 0.65) }, '블러프 베팅')
    }
    return advise({ type: 'check' }, '체크')
  }
  {
    const vsShove = decideVsShove(c, 0.56)
    if (vsShove) return vsShove
  }
  if (c.canRaise && c.equity >= 0.8 && r < 0.7) {
    return advise({ type: 'raise', to: clampRaiseTo(state, p, state.currentBet + c.pot) }, '강하게 레이즈')
  }
  if (c.canRaise && state.street !== 'river' && r < 0.12 * c.bluffFactor * p.intensity && c.toCall < p.chips * 0.3) {
    return advise({ type: 'raise', to: clampRaiseTo(state, p, state.currentBet + c.pot * 0.9) }, '블러프 레이즈')
  }
  if (c.equity >= c.potOdds - 0.03) return advise({ type: 'call' }, '루즈 콜')
  if (c.canRaise && state.street === 'river' && r < 0.05 * c.bluffFactor) {
    return advise({ type: 'raise', to: clampRaiseTo(state, p, state.currentBet + c.pot) }, '리버 블러프')
  }
  return advise({ type: 'fold' }, '저항이 세면 접는다')
}

// ───────── 포포 🐻: 콜링 스테이션 (loose-passive) ─────────
function decideStation(state: GameState, p: Player, c: Ctx): Advice {
  const advise = (action: Action, reason: string): Advice => ({ action, reason, equity: c.equity })
  const r = Math.random()

  if (c.isPreflop) {
    if (c.toCall <= 0) {
      if (c.canRaise && c.equity > c.fairShare * 1.8 && r < 0.25) {
        return advise({ type: 'raise', to: clampRaiseTo(state, p, BIG_BLIND * 3) }, '이건 진짜 좋아서')
      }
      return advise({ type: 'check' }, '체크')
    }
    const vsShove = decideVsShove(c, 0.52) // 스테이션은 올인도 남들보다 넓게 받는다
    if (vsShove) return vsShove
    if (c.toCall > p.chips * 0.35) {
      if (c.equity > c.fairShare * 1.25) return advise({ type: 'call' }, '큰 베팅이지만 콜')
      return advise({ type: 'fold' }, '너무 커서 폴드')
    }
    if (c.equity > (c.fairShare * 0.55) / p.intensity || c.toCall <= BIG_BLIND * 2) {
      return advise({ type: 'call' }, '일단 콜')
    }
    return advise({ type: 'fold' }, '이건 아니다')
  }

  // 포스트플랍: 뭐라도 걸쳤으면 팟 오즈 무시하고 콜
  if (c.toCall <= 0) {
    if (c.canRaise && c.equity > 0.85 && r < 0.5) {
      return advise({ type: 'raise', to: clampRaiseTo(state, p, c.pot * 0.5) }, '이건 베팅해야지')
    }
    return advise({ type: 'check' }, '체크')
  }
  {
    const vsShove = decideVsShove(c, 0.52)
    if (vsShove) return vsShove
  }
  if (c.canRaise && c.equity > 0.88 && r < 0.4) {
    return advise({ type: 'raise', to: clampRaiseTo(state, p, state.currentBet * 2.2) }, '레이즈')
  }
  const anyPiece = c.equity > (c.fairShare * 0.72) / p.intensity
  if (anyPiece || c.equity >= c.potOdds * 0.7) return advise({ type: 'call' }, '혹시 모르니까 콜')
  if (c.toCall <= BIG_BLIND && r < 0.5) return advise({ type: 'call' }, '싸니까 콜')
  return advise({ type: 'fold' }, '완전 꽝이라 폴드')
}

// ───────── 나비 🐱: 함정형 TAG (tight-aggressive + slow-play) ─────────
function decideTrapper(state: GameState, p: Player, c: Ctx): Advice {
  const advise = (action: Action, reason: string): Advice => ({ action, reason, equity: c.equity })
  const r = Math.random()

  // 설치된 함정 유지/발동
  if (!c.isPreflop && p.plan?.type === 'trap') {
    if (c.equity < 0.7) {
      p.plan = null // 보드가 위험해져 함정 해제 → 아래의 평범한 판단으로
    } else if (state.street === p.plan.setOn) {
      if (c.toCall > 0) return advise({ type: 'call' }, '(함정) 조용히 콜')
      return advise({ type: 'check' }, '(함정) 약한 척 체크')
    } else {
      p.plan = null
      if (c.canRaise) {
        const to = c.toCall > 0 ? state.currentBet + c.pot : c.pot * 0.9
        return advise({ type: 'raise', to: clampRaiseTo(state, p, to) }, '함정 발동 — 크게')
      }
      return advise({ type: 'call' }, '함정 콜')
    }
  }

  if (c.isPreflop) {
    if (c.toCall <= 0) {
      if (c.canRaise && c.equity > c.fairShare * 1.4 && r < 0.6) {
        return advise({ type: 'raise', to: clampRaiseTo(state, p, BIG_BLIND * 3) }, '좋은 패 레이즈')
      }
      return advise({ type: 'check' }, '체크')
    }
    const vsShove = decideVsShove(c, 0.58)
    if (vsShove) return vsShove
    if (c.equity > c.fairShare * 1.8 && r < 0.35) {
      return advise({ type: 'call' }, '프리미엄 슬로우플레이') // 최강 패를 숨기고 콜만
    }
    if (c.canRaise && c.equity > c.fairShare * 1.4 && r < 0.7) {
      return advise(
        { type: 'raise', to: clampRaiseTo(state, p, Math.max(state.currentBet * 3, BIG_BLIND * 3)) },
        '타이트한 레이즈',
      )
    }
    if (c.equity > c.fairShare * 1.05) return advise({ type: 'call' }, '괜찮은 패 콜')
    if (c.toCall <= BIG_BLIND && c.equity > c.fairShare * 0.85) return advise({ type: 'call' }, '싸게 보기')
    return advise({ type: 'fold' }, '기다린다')
  }

  {
    const vsShove = decideVsShove(c, 0.58)
    if (vsShove) return vsShove
  }

  // 함정 설치: 플랍/턴에서 아주 강한 패면 절반 확률로 약한 척
  if (p.plan === null && c.equity >= 0.8 && (state.street === 'flop' || state.street === 'turn') && r < 0.5 * p.intensity) {
    p.plan = { type: 'trap', setOn: state.street }
    if (c.toCall > 0) return advise({ type: 'call' }, '(함정 설치) 콜만')
    return advise({ type: 'check' }, '(함정 설치) 체크')
  }

  // 평범한 TAG
  const valueThresh = 0.66 - (c.callFactor - 1) * 0.1
  if (c.toCall <= 0) {
    if (c.canRaise && c.equity >= valueThresh && r < 0.8) {
      return advise({ type: 'raise', to: clampRaiseTo(state, p, c.pot * 0.7) }, '밸류 베팅')
    }
    if (c.canRaise && r < 0.08 * c.bluffFactor) {
      return advise({ type: 'raise', to: clampRaiseTo(state, p, c.pot * 0.6) }, '가끔은 블러프')
    }
    return advise({ type: 'check' }, '체크')
  }
  if (c.canRaise && c.equity >= 0.82 && r < 0.6) {
    return advise({ type: 'raise', to: clampRaiseTo(state, p, state.currentBet + c.pot * 0.8) }, '밸류 레이즈')
  }
  if (c.equity >= c.potOdds + 0.08) return advise({ type: 'call' }, '계산상 콜')
  if (c.toCall <= BIG_BLIND && c.equity >= c.potOdds * 0.85) return advise({ type: 'call' }, '싸니까 콜')
  return advise({ type: 'fold' }, '아니면 접는다')
}

// ───────── 바위 🪨: 초타이트 니트 (tight-passive) — 베팅하면 거의 진짜 ─────────
function decideRock(state: GameState, p: Player, c: Ctx): Advice {
  const advise = (action: Action, reason: string): Advice => ({ action, reason, equity: c.equity })
  const r = Math.random()
  // intensity가 높을수록 아주 약간 느슨해진다
  const premium = c.fairShare * 1.5 * (2 - p.intensity)

  if (c.isPreflop) {
    if (c.toCall <= 0) {
      if (c.canRaise && c.equity > premium && r < 0.7) {
        return advise({ type: 'raise', to: clampRaiseTo(state, p, BIG_BLIND * 3) }, '프리미엄 레이즈')
      }
      return advise({ type: 'check' }, '체크')
    }
    const vsShove = decideVsShove(c, 0.62) // 바위는 올인도 확실할 때만 받는다
    if (vsShove) return vsShove
    if (c.equity > premium * 1.15) {
      if (c.canRaise && r < 0.75) {
        return advise(
          { type: 'raise', to: clampRaiseTo(state, p, Math.max(state.currentBet * 3, BIG_BLIND * 3)) },
          '최상급 패',
        )
      }
      return advise({ type: 'call' }, '최상급 패 콜')
    }
    if (c.equity > premium) return advise({ type: 'call' }, '좋은 패만 친다')
    if (c.toCall <= BIG_BLIND && c.equity > c.fairShare * 1.1) return advise({ type: 'call' }, '싸니까 한 번')
    return advise({ type: 'fold' }, '패스')
  }

  // 포스트플랍: 정직 그 자체 — 블러핑 없음
  if (c.toCall <= 0) {
    if (c.canRaise && c.equity > 0.75 && r < 0.75) {
      return advise({ type: 'raise', to: clampRaiseTo(state, p, c.pot * 0.6) }, '진짜 패 베팅')
    }
    return advise({ type: 'check' }, '체크')
  }
  {
    const vsShove = decideVsShove(c, 0.62)
    if (vsShove) return vsShove
  }
  if (c.canRaise && c.equity > 0.85 && r < 0.6) {
    return advise({ type: 'raise', to: clampRaiseTo(state, p, state.currentBet + c.pot * 0.8) }, '확실할 때만 레이즈')
  }
  if (c.equity >= c.potOdds + 0.12) return advise({ type: 'call' }, '이 정도면 콜')
  return advise({ type: 'fold' }, '아니면 만다')
}

// ───────── 균형형: 사람용 힌트/코치 + balanced 봇의 교과서적 판단 ─────────
function decideBalanced(state: GameState, p: Player, c: Ctx): Advice {
  const { tight, aggression } = p.personality
  const advise = (action: Action, reason: string): Advice => ({ action, reason, equity: c.equity })

  if (c.toCall <= 0) {
    const betChance =
      c.edge > 0.25 ? 0.9 :
      c.edge > 0.12 ? 0.4 + aggression * 0.4 :
      c.edge > 0 ? aggression * 0.25 :
      aggression * 0.1
    if (c.canRaise && Math.random() < betChance) {
      const to = clampRaiseTo(state, p, state.currentBet + Math.max(BIG_BLIND, c.pot * (0.4 + c.equity * 0.5)))
      return advise(
        { type: 'raise', to },
        c.edge > 0.12
          ? `${c.label} — 평균(${Math.round(c.fairShare * 100)}%)보다 높아요. 베팅으로 가치를 키우세요.`
          : `${c.label} — 강하진 않지만 베팅으로 상대를 접게 만들 수도 있어요.`,
      )
    }
    return advise({ type: 'check' }, `${c.label} — 돈을 내지 않고 다음 카드를 보는 게 이득이에요. 체크!`)
  }

  const oddsPct = Math.round(c.potOdds * 100)

  // 올인급 베팅: 사실상 베팅한 상대와의 1:1 승부이므로 callEquity로 판단
  if (c.facingShove) {
    const pctHu = Math.round(c.callEquity * 100)
    const need = Math.round((c.potOdds + 0.04) * 100)
    if (c.callEquity >= c.potOdds + 0.04) {
      return advise(
        { type: 'call' },
        `올인 콜은 사실상 베팅한 상대와의 1:1 승부예요. 1:1 승률 약 ${pctHu}%가 필요 승률(약 ${need}%)을 넘어요. 콜!`,
      )
    }
    return advise(
      { type: 'fold' },
      `올인 콜은 베팅한 상대와의 1:1 승부인데, 1:1 승률 약 ${pctHu}%로는 필요 승률(약 ${need}%)에 못 미쳐요. 폴드!`,
    )
  }

  if (c.canRaise && c.equity > c.potOdds + 0.15 && c.edge > 0.12 && Math.random() < 0.35 + aggression * 0.5) {
    const to = clampRaiseTo(state, p, state.currentBet + c.pot * (0.6 + aggression * 0.4))
    return advise({ type: 'raise', to }, `${c.label} — 아주 유리한 상황이에요. 레이즈로 팟을 키우세요!`)
  }

  let margin = (tight - 0.5) * 0.08 - 0.02
  if (c.toCall > p.chips * 0.5) margin += 0.06 + tight * 0.04 // 스택 절반이 넘는 베팅은 더 신중하게
  if (c.equity >= c.potOdds + margin) {
    return advise(
      { type: 'call' },
      `${c.label} — 콜 비용은 팟의 ${oddsPct}%인데 승률이 그보다 높아요. 콜이 수학적으로 이득!`,
    )
  }

  if (c.toCall <= BIG_BLIND && c.equity >= c.potOdds * 0.8) {
    return advise({ type: 'call' }, `${c.label} — 아슬아슬하지만 콜 비용이 싸서 한번 볼 만해요.`)
  }

  if (c.canRaise && state.street !== 'river' && Math.random() < aggression * 0.05) {
    const to = clampRaiseTo(state, p, state.currentBet + c.pot * 0.8)
    return advise({ type: 'raise', to }, `(블러핑) ${c.label}지만 가끔은 과감하게 밀어붙이는 것도 전략이에요.`)
  }

  return advise(
    { type: 'fold' },
    `${c.label} — 콜 비용(팟의 ${oddsPct}%)보다 승률이 낮아서 따라갈수록 손해예요. 폴드!`,
  )
}
