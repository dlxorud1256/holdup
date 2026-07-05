import { Player } from '../game/types'
import { fmt, GameState } from '../game/engine'
import { cardKey } from '../game/deck'
import { CardView } from './CardView'

interface Props {
  p: Player
  state: GameState
  highlight?: Set<string>
  wonAmount?: number // 이번 핸드 획득액 — 있으면 승리 연출
}

export function PlayerSeat({ p, state, highlight, wonAmount }: Props) {
  const isTurn = state.phase === 'betting' && state.currentIdx === p.id
  const isDealer = state.dealerIdx === p.id
  const isSB = state.sbIdx === p.id
  const isBB = state.bbIdx === p.id
  const won = wonAmount != null && wonAmount > 0
  const cls = [
    'seat',
    p.isHuman ? 'human' : '',
    p.folded && !p.out ? 'folded' : '',
    p.out ? 'out' : '',
    isTurn ? 'turn' : '',
    won ? 'won' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className={cls}>
      {won && <div className="win-float">+{fmt(wonAmount!)}</div>}
      <div className="seat-top">
        <span className="avatar">{p.avatar}</span>
        <div className="seat-info">
          <div className="seat-name">
            {p.name}
            {isDealer && <span className="badge" title="딜러 버튼">D</span>}
            {isSB && <span className="badge blind" title="스몰 블라인드">SB</span>}
            {isBB && <span className="badge blind" title="빅 블라인드">BB</span>}
          </div>
          <div className="seat-chips">💰 {fmt(p.chips)}</div>
        </div>
      </div>
      <div className="seat-cards">
        {p.out ? (
          <span className="out-label">탈락</span>
        ) : (
          p.cards.map((c, i) => (
            <CardView
              key={cardKey(c)}
              card={c}
              hidden={!p.isHuman && !p.revealed}
              highlight={highlight?.has(cardKey(c))}
              small={!p.isHuman}
              dealDelay={i * 90}
            />
          ))
        )}
      </div>
      <div className="seat-bottom">
        {p.bet > 0 && <span className="seat-bet">베팅 {fmt(p.bet)}</span>}
        {p.lastAction && <span className="seat-action">{p.lastAction}</span>}
        {isTurn && !p.isHuman && <span className="thinking">생각 중…</span>}
        {isTurn && p.isHuman && <span className="your-turn">내 차례!</span>}
      </div>
    </div>
  )
}
