import { useEffect, useState } from 'react'
import { Action, applyAction, BIG_BLIND, fmt, GameState, newGame, potSize, SMALL_BLIND, startHand } from './game/engine'
import { Player } from './game/types'
import { decide } from './game/ai'
import { describeHoleCards, evaluateBest, handKoreanName } from './game/handEval'
import { cardKey } from './game/deck'
import { CardView } from './components/CardView'
import { PlayerSeat } from './components/PlayerSeat'
import { ActionBar } from './components/ActionBar'
import { LogPanel } from './components/LogPanel'
import { GuideModal, HelpModal } from './components/Modals'

const STREET_KO: Record<string, string> = { preflop: '프리플랍', flop: '플랍', turn: '턴', river: '리버' }

const clone = (s: GameState) => structuredClone(s)

function actionLabel(a: Action, state: GameState, human: Player): string {
  switch (a.type) {
    case 'fold': return '폴드'
    case 'check': return '체크'
    case 'call': return `콜 ${fmt(Math.min(Math.max(0, state.currentBet - human.bet), human.chips))}`
    case 'raise': return `레이즈 (${fmt(a.to)}까지)`
  }
}

export default function App() {
  const [state, setState] = useState<GameState>(() => startHand(newGame()))
  const [showGuide, setShowGuide] = useState(false)
  const [showHelp, setShowHelp] = useState(true) // 처음 접속하면 게임 방법부터 보여준다
  const [hint, setHint] = useState<string | null>(null)

  const human = state.players[0]
  const isHumanTurn = state.phase === 'betting' && state.players[state.currentIdx].isHuman

  // 봇 차례를 자동으로 진행 (생각하는 시간을 줘서 초보자가 따라가기 쉽게)
  useEffect(() => {
    if (state.phase !== 'betting') return
    if (state.players[state.currentIdx].isHuman) return
    const t = setTimeout(() => {
      setState(s => {
        if (s.phase !== 'betting') return s
        if (s.players[s.currentIdx].isHuman) return s
        const ns = clone(s)
        const advice = decide(ns, ns.players[ns.currentIdx])
        return applyAction(ns, advice.action)
      })
    }, 1000 + Math.random() * 800)
    return () => clearTimeout(t)
  }, [state.actionSeq, state.phase, state.currentIdx, state.players])

  useEffect(() => {
    setHint(null)
  }, [state.actionSeq])

  const act = (a: Action) => {
    setState(s => {
      if (s.phase !== 'betting' || !s.players[s.currentIdx].isHuman) return s
      return applyAction(clone(s), a)
    })
  }

  const nextHand = () => setState(s => startHand(clone(s)))
  const restart = () => setState(() => startHand(newGame()))

  const onHint = () => {
    const advice = decide(state, human)
    setHint(`${advice.reason} → 추천: ${actionLabel(advice.action, state, human)}`)
  }

  const best = state.community.length >= 3 && !human.folded && human.cards.length === 2
    ? evaluateBest([...human.cards, ...state.community])
    : null
  const highlight = new Set(best ? best.cards.map(cardKey) : [])
  const myHand = human.folded && !human.out
    ? '폴드함'
    : best
      ? handKoreanName(best)
      : human.cards.length === 2
        ? describeHoleCards(human.cards)
        : ''

  const bots = state.players.slice(1)

  return (
    <div className="app">
      <header className="header">
        <h1>🃏 홀덤 연습장</h1>
        <div className="header-info">블라인드 {SMALL_BLIND}/{BIG_BLIND}</div>
        <div className="header-btns">
          <button className="ghost-btn" onClick={() => setShowGuide(true)}>📖 족보표</button>
          <button className="ghost-btn" onClick={() => setShowHelp(true)}>❓ 게임 방법</button>
        </div>
      </header>

      <div className="main">
        <div className="table-wrap">
          <div className="table">
            <div className="bots">
              {bots.map(p => <PlayerSeat key={p.id} p={p} state={state} />)}
            </div>
            <div className="board">
              <div className="street-label">
                {state.phase === 'betting' ? STREET_KO[state.street] : '결과'}
              </div>
              <div className="community">
                {state.community.map(c => (
                  <CardView key={cardKey(c)} card={c} highlight={highlight.has(cardKey(c))} />
                ))}
                {Array.from({ length: 5 - state.community.length }).map((_, i) => (
                  <div key={i} className="card slot" />
                ))}
              </div>
              <div className="pot">팟 💰 {fmt(potSize(state))}</div>
            </div>
            <div className="me-row">
              <PlayerSeat p={human} state={state} highlight={highlight} />
              {myHand && (
                <div className="my-hand-label">
                  현재 족보<br /><b>{myHand}</b>
                  {best && <><br /><small>금색 테두리가 최고 조합</small></>}
                </div>
              )}
            </div>
          </div>

          <div className="bottom-panel">
            {state.phase === 'betting' && (
              <ActionBar state={state} human={human} isHumanTurn={isHumanTurn} act={act} onHint={onHint} hint={hint} />
            )}
            {state.phase === 'handOver' && state.handOver && (
              <div className="hand-over">
                <div className="winners">
                  {state.handOver.winners.map((w, i) => (
                    <div key={i} className="winner-line">
                      🏆 <b>{w.avatar} {w.name}</b>
                      {w.handName ? ` — ${w.handName}` : ' — 모두 폴드'}{' '}
                      <span className="won">+{fmt(w.amount)}</span>
                    </div>
                  ))}
                </div>
                <button className="btn primary" onClick={nextHand}>다음 핸드 ▶</button>
              </div>
            )}
            {state.phase === 'gameOver' && (
              <div className="hand-over">
                <div className="winners">
                  <div className="winner-line">
                    {state.gameResult === 'won'
                      ? '🎉 축하해요! 모든 상대의 칩을 가져왔어요!'
                      : '😢 칩을 모두 잃었어요. 다시 도전해봐요!'}
                  </div>
                </div>
                <button className="btn primary" onClick={restart}>새 게임 시작</button>
              </div>
            )}
          </div>
        </div>

        <LogPanel log={state.log} />
      </div>

      {showGuide && <GuideModal onClose={() => setShowGuide(false)} />}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </div>
  )
}
