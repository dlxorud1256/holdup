import { Card } from '../game/types'
import { rankName, SUIT_RED, SUIT_SYMBOL } from '../game/deck'

interface Props {
  card?: Card
  hidden?: boolean
  highlight?: boolean
  small?: boolean
}

export function CardView({ card, hidden, highlight, small }: Props) {
  const size = small ? ' small' : ''
  if (!card || hidden) return <div className={`card back${size}`} />
  return (
    <div className={`card ${SUIT_RED[card.suit] ? 'red' : 'black'}${highlight ? ' hl' : ''}${size}`}>
      <span className="card-rank">{rankName(card.rank)}</span>
      <span className="card-suit">{SUIT_SYMBOL[card.suit]}</span>
    </div>
  )
}
