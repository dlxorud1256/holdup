import OpenAI from 'openai'
import { Action, fmt, GameState, potSize } from './engine'
import { decide } from './ai'
import { cardText } from './deck'
import { Street } from './types'

// 실시간 홀덤 코치: 현재 게임 상황을 컨텍스트로 붙여 GPT에게 질문한다.
// API 키는 사용자의 브라우저(localStorage)에만 저장된다.

export const API_KEY_STORAGE = 'holdup_openai_key'

// 질문·복기 모두 GPT-5.4 mini (호출당 약 3~4원).
// 추론(reasoning) 토큰은 출력 요금으로 과금되므로 effort를 명시적으로 꺼둔다.
const COACH_MODEL = 'gpt-5.4-mini'

// OpenAI는 브라우저 직접 호출을 CORS로 차단하므로 Vercel 함수 프록시를 경유한다.
// 미국 리전에서 실행돼 OpenAI 지역 차단도 피한다. 키는 저장하지 않고 통과만 시킨다 (proxy/ 참고).
const PROXY_BASE_URL = 'https://holdup-coach-proxy.vercel.app/api'

const STREET_KO: Record<Street, string> = { preflop: '프리플랍', flop: '플랍', turn: '턴', river: '리버' }

const SYSTEM_PROMPT = `당신은 초보자 옆에 앉아 실시간으로 가르쳐주는 친절한 텍사스 홀덤 코치입니다.
사용자는 AI 봇 3명과 연습 게임을 하는 중이고, 매 질문마다 [현재 상황]에 게임 상태가 주어집니다.

상대 봇들에 대해 알아야 할 것:
- 봇들의 플레이 유형은 게임마다 비밀리에 섞여 배정됩니다. 당신도 누가 어떤 유형인지 모릅니다.
- 존재할 수 있는 유형: 매니악(공격·블러핑 잦음), 콜링 스테이션(웬만하면 콜), 함정형(강한 패를 숨겼다가 나중에 크게), 바위(초타이트, 베팅하면 거의 진짜), 균형형(교과서적).
- [현재 상황]에 주어지는 봇별 관찰 통계(참여율, 레이즈 비율, 최근 행동)를 근거로 사용자와 함께 유형을 추리하세요. "~인 것 같아요" 수준으로 말하고 단정하지 마세요.
- 봇들은 가끔(약 10% 안팎) 자기 유형과 다르게 치기도 합니다. 표본이 적을 때는 특히 확신하지 마세요.
- 유형을 읽으면 어떻게 착취할지(예: 콜을 잘 하는 상대에겐 블러핑 금지, 밸류 위주)까지 알려주세요.

지켜야 할 것:
- 쉬운 한국어로 설명하고, 포커 용어는 처음 나올 때 한 줄로 풀어서 설명하세요.
- 답변은 2~5문장으로 짧고 명확하게. 꼭 필요할 때만 목록을 쓰세요.
- [현재 상황]에 주어진 승률·팟 오즈 숫자를 근거로 설명하세요. 숫자를 지어내지 마세요.
- 상대 봇들의 숨겨진 카드는 당신도 모릅니다. 아는 척하지 마세요.
- 정답만 알려주기보다 "왜 그런지" 원리를 이해시키는 데 초점을 두세요. 초보자가 다음에 비슷한 상황에서 스스로 판단할 수 있게요.
- 시스템 추천과 다른 의견이 있으면 솔직하게 말해도 됩니다. 단, 근거를 함께 설명하세요.`

function actionLabel(a: Action): string {
  switch (a.type) {
    case 'fold': return '폴드'
    case 'check': return '체크'
    case 'call': return '콜'
    case 'raise': return `레이즈 (${fmt(a.to)}까지)`
  }
}

// 사람 플레이어 시점에서 보이는 정보만 정리한다 (봇의 홀 카드는 제외).
export function buildGameContext(state: GameState): string {
  const human = state.players[0]
  const pot = potSize(state)
  const toCall = Math.max(0, state.currentBet - human.bet)
  const lines: string[] = []

  lines.push(`- 단계: ${state.phase === 'betting' ? STREET_KO[state.street] : '핸드 종료 (결과 확인 중)'}`)
  if (human.cards.length === 2) lines.push(`- 내 카드: ${human.cards.map(cardText).join(' ')}`)
  lines.push(`- 공용 카드: ${state.community.length > 0 ? state.community.map(cardText).join(' ') : '아직 없음'}`)
  lines.push(`- 팟: ${fmt(pot)} / 내 칩: ${fmt(human.chips)} / 지금 콜 비용: ${fmt(toCall)}`)

  const others = state.players.slice(1).map(p => {
    const status = p.out ? '탈락' : p.folded ? '폴드' : p.allIn ? '올인' : '플레이 중'
    return `${p.name}(칩 ${fmt(p.chips)}, ${status})`
  })
  lines.push(`- 상대: ${others.join(', ')}`)

  if (state.phase === 'betting' && !human.folded && !human.out && human.cards.length === 2) {
    const advice = decide(state, human)
    lines.push(`- 시스템 추천: ${actionLabel(advice.action)} — ${advice.reason}`)
    lines.push(`- 몬테카를로 추정 승률: 약 ${Math.round(advice.equity * 100)}%`)
    if (toCall > 0) lines.push(`- 팟 오즈: 약 ${Math.round((toCall / (pot + toCall)) * 100)}% (콜 비용 ÷ (팟+콜 비용))`)
    if (state.currentIdx === 0) lines.push(`- 지금 내 차례입니다.`)
  }

  if (Array.isArray(state.observed)) {
    // 봇별 통계 — 사용자와 코치가 함께 유형을 추리하는 단서
    const botLines = state.players.slice(1).filter(b => !b.out).map(b => {
      const s = state.observed[b.id]
      if (!s || s.handsDealt < 3) return `${b.name}: 아직 표본 부족 (${s?.handsDealt ?? 0}핸드)`
      const vpip = Math.round((s.handsVoluntary / s.handsDealt) * 100)
      const raisePct = s.actions > 0 ? Math.round((s.raises / s.actions) * 100) : 0
      const foldPct = s.facedBet > 0 ? Math.round((s.foldToBet / s.facedBet) * 100) : 0
      return `${b.name}: ${s.handsDealt}핸드 중 참여 ${vpip}%, 액션 중 레이즈 ${raisePct}%, 베팅 앞 폴드 ${foldPct}%`
    })
    lines.push(`- 봇 관찰 통계 (유형 추리 단서):\n${botLines.map(t => `  · ${t}`).join('\n')}`)

    const me = state.observed[0]
    if (me && me.facedBet >= 6) {
      lines.push(
        `- 봇들이 관찰한 내 성향: 베팅 앞에서 폴드 ${Math.round((me.foldToBet / me.facedBet) * 100)}%` +
        ` (봇들은 이 성향에 맞춰 블러핑·밸류 베팅 빈도를 조절합니다)`,
      )
    }
    if (me && (me.bigPreflopRaises ?? 0) >= 2) {
      lines.push(
        `- 내 프리플랍 올인급 레이즈: ${me.bigPreflopRaises}회 — 봇들이 눈치채고 점점 넓은 범위로 콜하기 시작합니다`,
      )
    }
  }

  const recent = state.log.slice(-12).map(l => l.text)
  if (recent.length > 0) lines.push(`- 최근 진행:\n${recent.map(t => `  · ${t}`).join('\n')}`)
  lines.push('- (상대 봇들의 숨겨진 카드는 알 수 없습니다)')

  return lines.join('\n')
}

// 핸드 종료 후 자동 복기 요청문
export const HAND_REVIEW_QUESTION =
  '방금 끝난 핸드에서 내 플레이를 복기해줘. 잘한 결정 하나와 아쉬운 결정 하나(있다면)를 짚고, ' +
  '다음에 비슷한 상황이 오면 어떻게 하면 좋을지 알려줘. 4문장 이내로 짧게.'

// 방금 끝난 핸드의 복기용 컨텍스트. 복기할 가치가 없는 핸드(참여 없이 폴드 등)면 null.
export function buildHandReviewContext(state: GameState): string | null {
  if (state.phase === 'betting') return null
  const human = state.players[0]
  if (human.cards.length !== 2) return null
  const voluntary = Array.isArray(state.voluntary) ? state.voluntary[0] : true
  if (human.folded && !voluntary) return null // 돈 안 넣고 접은 핸드는 복기 생략 (비용 절약)

  // 마지막 "───── N번째 핸드 ─────" 구분선부터가 이번 핸드의 기록
  let start = 0
  state.log.forEach((l, i) => {
    if (l.text.startsWith('─────')) start = i
  })
  const handLog = state.log.slice(start).map(l => `  · ${l.text}`)

  const lines: string[] = []
  lines.push(`- 내 카드: ${human.cards.map(cardText).join(' ')}`)
  if (state.community.length > 0) lines.push(`- 공용 카드: ${state.community.map(cardText).join(' ')}`)
  lines.push(`- 내 남은 칩: ${fmt(human.chips)}`)
  if (state.handOver) {
    const result = state.handOver.winners
      .map(w => `${w.name} +${fmt(w.amount)}${w.handName ? ` (${w.handName})` : ''}`)
      .join(', ')
    lines.push(`- 결과: ${result}`)
  }
  lines.push(`- 핸드 전체 기록:\n${handLog.join('\n')}`)
  return lines.join('\n')
}

export interface CoachTurn {
  role: 'user' | 'assistant'
  content: string
}

export async function askCoach(opts: {
  apiKey: string
  question: string
  context: string
  history: CoachTurn[]
  onDelta: (chunk: string) => void
}): Promise<string> {
  const client = new OpenAI({
    apiKey: opts.apiKey,
    baseURL: PROXY_BASE_URL,
    dangerouslyAllowBrowser: true, // 개인용 앱: 키는 사용자 본인 브라우저에만 저장됨
  })

  const input = [
    ...opts.history.map(h => ({ role: h.role, content: h.content })),
    { role: 'user' as const, content: `[현재 상황]\n${opts.context}\n\n[질문]\n${opts.question}` },
  ]

  const stream = await client.responses.create({
    model: COACH_MODEL,
    instructions: SYSTEM_PROMPT,
    input,
    reasoning: { effort: 'low' }, // 가벼운 추론 허용 (질문당 ~5원 수준, 유형 추리 등 복합 질문 품질 개선)
    max_output_tokens: 4096,
    stream: true,
  })

  let text = ''
  for await (const event of stream) {
    if (event.type === 'response.output_text.delta') {
      text += event.delta
      opts.onDelta(event.delta)
    }
  }
  return text
}

export function coachErrorMessage(e: unknown): string {
  if (e instanceof OpenAI.AuthenticationError) {
    return '⚠️ API 키가 올바르지 않아요. 패널 아래 "키 변경"에서 다시 설정해주세요.'
  }
  if (e instanceof OpenAI.RateLimitError) {
    return '⚠️ 요청이 너무 잦거나 크레딧이 부족해요. platform.openai.com에서 확인해주세요.'
  }
  if (e instanceof OpenAI.APIConnectionError) {
    return '⚠️ 네트워크 연결에 문제가 있어요. 인터넷 연결을 확인해주세요.'
  }
  if (e instanceof OpenAI.APIError) {
    return `⚠️ API 오류가 발생했어요 (${e.status}). 잠시 후 다시 시도해주세요.`
  }
  return '⚠️ 알 수 없는 오류가 발생했어요. 다시 시도해주세요.'
}
