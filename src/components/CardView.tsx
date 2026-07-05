import { Card } from '../game/types'
import { rankName, SUIT_RED, SUIT_SYMBOL } from '../game/deck'

interface Props {
  card?: Card
  hidden?: boolean
  highlight?: boolean
  small?: boolean
  dealDelay?: number // 딜링 스태거(ms) — 마운트 시 애니메이션 지연
}

export function CardView({ card, hidden, highlight, small, dealDelay }: Props) {
  const size = small ? ' small' : ''
  const style = dealDelay ? { animationDelay: `${dealDelay}ms` } : undefined
  if (!card || hidden) return <div className={`card back${size}`} style={style} />
  return (
    <div className={`card ${SUIT_RED[card.suit] ? 'red' : 'black'}${highlight ? ' hl' : ''}${size}`} style={style}>
      <span className="card-rank">{rankName(card.rank)}</span>
      <span className="card-suit">{SUIT_SYMBOL[card.suit]}</span>
    </div>
  )
}
