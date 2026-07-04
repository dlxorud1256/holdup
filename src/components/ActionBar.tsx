import { useEffect, useState } from 'react'
import { Player } from '../game/types'
import { Action, fmt, GameState, potSize } from '../game/engine'

interface Props {
  state: GameState
  human: Player
  isHumanTurn: boolean
  act: (a: Action) => void
  onHint: () => void
  hint: string | null
}

export function ActionBar({ state, human, isHumanTurn, act, onHint, hint }: Props) {
  const toCall = Math.max(0, state.currentBet - human.bet)
  const callPay = Math.min(toCall, human.chips)
  const pot = potSize(state)
  const maxTo = human.bet + human.chips
  const minTo = Math.min(state.currentBet + state.minRaise, maxTo)
  const canRaise = maxTo > state.currentBet && !human.allIn

  const [raiseTo, setRaiseTo] = useState(minTo)
  useEffect(() => {
    setRaiseTo(minTo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.actionSeq])

  const round50 = (x: number) => Math.round(x / 50) * 50
  const clampTo = (x: number) => Math.max(minTo, Math.min(maxTo, round50(x)))
  const disabled = !isHumanTurn || human.folded || human.allIn

  return (
    <div className="action-area">
      {hint && <div className="hint-bubble">💡 {hint}</div>}
      {!isHumanTurn && (
        <div className="waiting">
          {human.folded ? '폴드했어요 — 이번 핸드 결과를 기다리는 중…' : '상대의 차례를 기다리는 중…'}
        </div>
      )}
      <div className="actions">
        <button className="btn fold" disabled={disabled} onClick={() => act({ type: 'fold' })}>
          폴드<span>이번 판 포기</span>
        </button>
        {toCall === 0 ? (
          <button className="btn check" disabled={disabled} onClick={() => act({ type: 'check' })}>
            체크<span>베팅 없이 넘기기</span>
          </button>
        ) : (
          <button className="btn check" disabled={disabled} onClick={() => act({ type: 'call' })}>
            {callPay >= human.chips ? '올인 콜' : `콜 ${fmt(callPay)}`}
            <span>상대 베팅 따라가기</span>
          </button>
        )}
        {canRaise && (
          <div className="raise-box">
            <div className="raise-presets">
              <button disabled={disabled} onClick={() => setRaiseTo(minTo)}>최소</button>
              <button disabled={disabled} onClick={() => setRaiseTo(clampTo(state.currentBet + pot / 2))}>½ 팟</button>
              <button disabled={disabled} onClick={() => setRaiseTo(clampTo(state.currentBet + pot))}>팟</button>
              <button disabled={disabled} onClick={() => setRaiseTo(maxTo)}>올인</button>
            </div>
            <input
              type="range"
              min={minTo}
              max={maxTo}
              step={50}
              value={raiseTo}
              disabled={disabled}
              onChange={e => setRaiseTo(Number(e.target.value))}
            />
            <button className="btn raise" disabled={disabled} onClick={() => act({ type: 'raise', to: clampTo(raiseTo) })}>
              {raiseTo >= maxTo ? '올인 🔥' : state.currentBet === 0 ? `벳 ${fmt(raiseTo)}` : `레이즈 ${fmt(raiseTo)}`}
              <span>{state.currentBet === 0 ? '먼저 베팅하기' : '베팅 올리기'}</span>
            </button>
          </div>
        )}
        <button className="btn hint-btn" disabled={disabled} onClick={onHint}>
          💡 힌트<span>추천 받기</span>
        </button>
      </div>
    </div>
  )
}
