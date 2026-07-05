export type Suit = 's' | 'h' | 'd' | 'c'

export interface Card {
  rank: number // 2~14 (11=J, 12=Q, 13=K, 14=A)
  suit: Suit
}

// 봇의 플레이 스타일 (아키타입) — 새 게임마다 봇들에게 비밀리에 섞어 배정된다.
// lag: 매니악 — 블러핑과 압박 위주 / station: 콜링 스테이션 — 웬만하면 콜, 블러핑 안 통함
// trapper: 함정형 — 강한 패를 숨겼다가 나중에 터뜨림 / rock: 바위 — 초타이트, 베팅하면 진짜
// balanced: 균형형 — 교과서적 판단 (사람용 힌트에도 사용)
export type BotStyle = 'human' | 'lag' | 'station' | 'trapper' | 'rock' | 'balanced'

// 다중 스트리트 계획: setOn 스트리트에서는 약한 척(체크/콜)하고, 다음 스트리트에 크게 침
export interface TrapPlan {
  type: 'trap'
  setOn: Street
}

// 플레이어별 관찰 통계 (게임 내내 누적).
// 사람 것(index 0)은 봇들의 적응형 판단에, 봇 것은 코치·플레이어의 유형 추리에 쓰인다.
export interface ObservedStats {
  handsDealt: number // 참여한 핸드 수
  handsVoluntary: number // 자발적으로 돈을 넣은 핸드 수 (VPIP)
  facedBet: number // 베팅에 직면한 횟수
  foldToBet: number // 그중 폴드한 횟수
  actions: number // 총 액션 수
  raises: number // 그중 레이즈 수
  bigPreflopRaises: number // 프리플랍 초대형 레이즈(올인급) 횟수 — 남발하면 봇들이 콜 범위를 넓힘
}

export interface Player {
  id: number
  name: string
  avatar: string
  isHuman: boolean
  chips: number
  cards: Card[]
  bet: number // 이번 스트리트에 낸 금액
  totalBet: number // 이번 핸드에 낸 총액 (사이드팟 계산용)
  folded: boolean
  allIn: boolean
  out: boolean // 칩 소진으로 게임에서 탈락
  lastAction: string | null
  revealed: boolean // 쇼다운에서 카드 공개 여부
  personality: { tight: number; aggression: number } // 0~1 (균형형 로직에서 사용, 게임마다 랜덤)
  style: BotStyle // 이번 게임의 기본 아키타입 (비공개)
  handStyle: BotStyle // 이번 핸드에 실제로 쓰는 스타일 (10~15%는 오프타입)
  intensity: number // 0.85~1.15 — 같은 유형이라도 게임마다 강도 편차
  plan: TrapPlan | null // 이번 핸드의 다중 스트리트 계획
}

export type Street = 'preflop' | 'flop' | 'turn' | 'river'
export type Phase = 'betting' | 'handOver' | 'gameOver'

export interface LogEntry {
  text: string
  kind: 'action' | 'info' | 'win' | 'street'
}
