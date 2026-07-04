import { Card, Suit } from './types'

const SUITS: Suit[] = ['s', 'h', 'd', 'c']

export const SUIT_SYMBOL: Record<Suit, string> = { s: '♠', h: '♥', d: '♦', c: '♣' }
export const SUIT_RED: Record<Suit, boolean> = { s: false, h: true, d: true, c: false }

export function rankName(rank: number): string {
  if (rank === 14) return 'A'
  if (rank === 13) return 'K'
  if (rank === 12) return 'Q'
  if (rank === 11) return 'J'
  return String(rank)
}

export function cardText(c: Card): string {
  return rankName(c.rank) + SUIT_SYMBOL[c.suit]
}

export function cardKey(c: Card): string {
  return c.rank + c.suit
}

export function newDeck(): Card[] {
  const deck: Card[] = []
  for (const suit of SUITS) {
    for (let rank = 2; rank <= 14; rank++) deck.push({ rank, suit })
  }
  return deck
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
