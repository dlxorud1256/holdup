export type Suit = 's' | 'h' | 'd' | 'c'

export interface Card {
  rank: number // 2~14 (11=J, 12=Q, 13=K, 14=A)
  suit: Suit
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
  personality: { tight: number; aggression: number } // 0~1
}

export type Street = 'preflop' | 'flop' | 'turn' | 'river'
export type Phase = 'betting' | 'handOver' | 'gameOver'

export interface LogEntry {
  text: string
  kind: 'action' | 'info' | 'win' | 'street'
}
