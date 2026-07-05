import { useEffect, useMemo, useRef, useState } from 'react'
import { Action, applyAction, fmt, GameState, newGame, peek, potSize, rebuy, startHand } from './game/engine'
import { GameMode, Player } from './game/types'
import { loadGame, saveGame } from './game/save'
import { isMuted, setMuted, sfx } from './game/sound'
import { decide } from './game/ai'
import { estimateEquity } from './game/equity'
import { describeHoleCards, evaluateBest, handKoreanName } from './game/handEval'
import { cardKey } from './game/deck'
import { CardView } from './components/CardView'
import { PlayerSeat } from './components/PlayerSeat'
import { ActionBar } from './components/ActionBar'
import { LogPanel } from './components/LogPanel'
import { HistoryPanel } from './components/HistoryPanel'
import { CoachPanel } from './components/CoachPanel'
import { GuideModal, HelpModal } from './components/Modals'

const STREET_KO: Record<string, string> = { preflop: '프리플랍', flop: '플랍', turn: '턴', river: '리버' }

const clone = (s: GameState) => structuredClone(s)

// 타이밍 텔: 결정이 어려운 상황일수록 봇이 오래 고민한다 (노이즈 포함).
// 쉬운 체크는 빠르게, 올인급 결정은 한참 장고 — 실제 사람의 리듬을 흉내낸다.
function botDelay(s: GameState): number {
  const p = s.players[s.currentIdx]
  const toCall = Math.max(0, s.currentBet - p.bet)
  const pot = potSize(s)
  let base: number
  if (toCall <= 0) base = 600 + Math.random() * 700 // 부담 없는 자리 — 가볍게
  else if (toCall >= p.chips * 0.4) base = 1800 + Math.random() * 2200 // 올인급 — 장고
  else if (toCall > pot * 0.5) base = 1200 + Math.random() * 1400 // 큰 베팅 — 고민
  else base = 700 + Math.random() * 900 // 평범한 콜 자리
  if (Math.random() < 0.06) base += 800 + Math.random() * 1500 // 가끔 이유 없는 고민 (읽기 방해 노이즈)
  return base
}

function actionLabel(a: Action, state: GameState, human: Player): string {
  switch (a.type) {
    case 'fold': return '폴드'
    case 'check': return '체크'
    case 'call': return `콜 ${fmt(Math.min(Math.max(0, state.currentBet - human.bet), human.chips))}`
    case 'raise': return `레이즈 (${fmt(a.to)}까지)`
  }
}

export default function App() {
  // mode가 null이면 모드 선택 화면 — 게임은 아직 시작 전 (phase 'handOver'로 대기)
  const [mode, setMode] = useState<GameMode | null>(null)
  const [state, setState] = useState<GameState>(() => newGame('tournament'))
  const [showGuide, setShowGuide] = useState(false)
  const [showHelp, setShowHelp] = useState(true) // 처음 접속하면 게임 방법부터 보여준다
  const [hint, setHint] = useState<string | null>(null)
  const [sideTab, setSideTab] = useState<'log' | 'history' | 'coach'>('log')
  const [muted, setMutedState] = useState(isMuted())

  const toggleMute = () => {
    setMuted(!muted)
    setMutedState(!muted)
  }
  const [pendingAsk, setPendingAsk] = useState<string | null>(null)

  const askCoachFromHistory = (question: string) => {
    setPendingAsk(question)
    setSideTab('coach')
  }

  const [botCount, setBotCount] = useState(3)

  const pickMode = (m: GameMode) => {
    setMode(m)
    setState(() => startHand(newGame(m, botCount)))
  }

  // 저장된 게임 (모드 선택 화면에서만 조회 — "이어서 하기" 제안용)
  const saved = mode === null ? loadGame() : null
  const resumeSaved = () => {
    if (!saved) return
    setMode(saved.mode ?? 'tournament')
    setState(() => saved)
  }

  // 게임이 진행 중이면 상태 변화마다 자동 저장 (새로고침·탭 닫기 대비)
  useEffect(() => {
    if (mode !== null) saveGame(state)
  }, [state, mode])

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
    }, botDelay(state))
    return () => clearTimeout(t)
  }, [state.actionSeq, state.phase, state.currentIdx, state.players])

  useEffect(() => {
    setHint(null)
  }, [state.actionSeq])

  // 효과음: 새 로그 라인을 보고 재생 (사람·봇 액션 모두 커버)
  const prevLogLen = useRef(0)
  useEffect(() => {
    const newLines = prevLogLen.current <= state.log.length ? state.log.slice(prevLogLen.current) : []
    prevLogLen.current = state.log.length
    let played = 0
    for (const l of newLines) {
      if (played >= 3) break // 한 번에 여러 줄이 쌓여도 소리는 최대 3개
      const t = l.text
      if (t.includes('획득')) { sfx.win(); played++ }
      else if (/폴드/.test(t) && !t.startsWith('─')) { sfx.fold(); played++ }
      else if (t.includes('체크')) { sfx.check(); played++ }
      else if (/콜 |레이즈|벳 |올인|블라인드 \d/.test(t)) { sfx.chip(); played++ }
    }
  }, [state.log.length, state.log])

  // 카드 딜링 소리: 새 핸드 시작·공용 카드 공개 시
  useEffect(() => {
    if (state.handNumber > 0) sfx.deal()
  }, [state.handNumber])
  useEffect(() => {
    if (state.community.length > 0) sfx.deal()
  }, [state.community.length])

  const act = (a: Action) => {
    setState(s => {
      if (s.phase !== 'betting' || !s.players[s.currentIdx].isHuman) return s
      return applyAction(clone(s), a)
    })
  }

  const nextHand = () => setState(s => startHand(clone(s)))
  const restart = () => {
    setMode(null) // 모드 선택 화면으로
    setState(() => newGame('tournament'))
  }
  const doRebuy = () => setState(s => startHand(rebuy(clone(s))))
  const doPeek = () => setState(s => peek(clone(s)))

  // 아직 안 까진 패가 있는 핸드 종료 상태에서만 훔쳐보기 가능
  const canPeek =
    (state.phase === 'handOver' || state.phase === 'gameOver') &&
    state.players.some(p => !p.isHuman && p.cards.length === 2 && !p.revealed)

  const onHint = () => {
    const advice = decide(state, human)
    setHint(`${advice.reason} → 추천: ${actionLabel(advice.action, state, human)}`)
  }

  const aliveOpponents = state.players.filter(q => !q.isHuman && !q.out && !q.folded).length
  // 승률은 같은 스트리트 안에서는 변하지 않으므로 카드/상대 수가 바뀔 때만 재계산
  const equity = useMemo(() => {
    if (state.phase !== 'betting' || human.folded || human.cards.length < 2) return null
    return estimateEquity(human.cards, state.community, aliveOpponents, 250)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.handNumber, state.phase, state.community.length, aliveOpponents, human.folded])

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

  // 핸드 종료 시 승자 연출 (+금액 플로팅, 좌석 글로우)
  const wonBy = new Map<string, number>()
  if (state.phase !== 'betting' && state.handOver) {
    for (const w of state.handOver.winners) wonBy.set(w.name, (wonBy.get(w.name) ?? 0) + w.amount)
  }

  return (
    <div className="app">
      <header className="header">
        <h1>🃏 홀덤 연습장</h1>
        <div className="header-info">
          {(state.mode ?? 'tournament') === 'cash' ? '💵 캐시' : '🏆 토너먼트'} · 블라인드 {fmt(state.sb ?? 50)}/{fmt(state.bb ?? 100)}
        </div>
        <div className="header-btns">
          <button className="ghost-btn" onClick={() => setShowGuide(true)}>📖 족보표</button>
          <button className="ghost-btn" onClick={() => setShowHelp(true)}>❓ 게임 방법</button>
          <button className="ghost-btn mute-btn" onClick={toggleMute} title={muted ? '소리 켜기' : '소리 끄기'}>
            {muted ? '🔇' : '🔊'}
          </button>
        </div>
      </header>

      <div className="main">
        <div className="table-wrap">
          <div className="table">
            <div className="bots">
              {bots.map(p => <PlayerSeat key={p.id} p={p} state={state} wonAmount={wonBy.get(p.name)} />)}
            </div>
            <div className="board">
              <div className="street-label">
                {state.phase === 'betting' ? STREET_KO[state.street] : '결과'}
              </div>
              <div className="community">
                {state.community.map((c, i) => (
                  <CardView
                    key={cardKey(c)}
                    card={c}
                    highlight={highlight.has(cardKey(c))}
                    dealDelay={i < 3 ? i * 110 : 0}
                  />
                ))}
                {Array.from({ length: 5 - state.community.length }).map((_, i) => (
                  <div key={i} className="card slot" />
                ))}
              </div>
              <div className="pot" key={potSize(state)}>팟 💰 {fmt(potSize(state))}</div>
            </div>
            <div className="me-row">
              <PlayerSeat p={human} state={state} highlight={highlight} wonAmount={wonBy.get(human.name)} />
              {myHand && (
                <div className="my-hand-label">
                  현재 족보<br /><b>{myHand}</b>
                  {equity !== null && (
                    <><br /><span className="equity">승률 약 {Math.round(equity * 100)}% (상대 {aliveOpponents}명)</span></>
                  )}
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
                <div className="over-btns">
                  {canPeek && (
                    <button
                      className="btn hint-btn"
                      title="실전엔 없는 연습용 특권! 결과보다 내 판단이 옳았는지에 집중하세요"
                      onClick={doPeek}
                    >
                      🫣 훔쳐보기<span>끝까지 갔다면?</span>
                    </button>
                  )}
                  <button className="btn primary" onClick={nextHand}>다음 핸드 ▶</button>
                </div>
              </div>
            )}
            {state.phase === 'gameOver' && (
              <div className="hand-over">
                <div className="winners">
                  <div className="winner-line">
                    {state.gameResult === 'won'
                      ? '🎉 축하해요! 모든 상대의 칩을 가져왔어요!'
                      : state.mode === 'cash'
                        ? '💸 칩이 다 떨어졌어요 — 리바이하고 계속할 수 있어요!'
                        : '😢 칩을 모두 잃었어요. 다시 도전해봐요!'}
                  </div>
                </div>
                <div className="over-btns">
                  {canPeek && (
                    <button className="btn hint-btn" onClick={doPeek}>🫣 훔쳐보기<span>끝까지 갔다면?</span></button>
                  )}
                  {state.mode === 'cash' && state.gameResult === 'lost' && (
                    <button className="btn primary" onClick={doRebuy}>💳 리바이 (칩 {fmt(10000)})</button>
                  )}
                  <button className="btn primary" onClick={restart}>새 게임</button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="sidebar">
          <div className="side-tabs">
            <button className={sideTab === 'log' ? 'active' : ''} onClick={() => setSideTab('log')}>
              📜 기록
            </button>
            <button className={sideTab === 'history' ? 'active' : ''} onClick={() => setSideTab('history')}>
              🕘 히스토리
            </button>
            <button className={sideTab === 'coach' ? 'active' : ''} onClick={() => setSideTab('coach')}>
              🎓 코치
            </button>
          </div>
          {/* 탭을 바꿔도 코치 대화가 유지되도록 모두 렌더하고 CSS로 숨긴다 */}
          <div className={`side-body${sideTab === 'log' ? '' : ' hide'}`}>
            <LogPanel log={state.log} />
          </div>
          <div className={`side-body${sideTab === 'history' ? '' : ' hide'}`}>
            <HistoryPanel
              history={state.history ?? []}
              onAskCoach={askCoachFromHistory}
              stats={Array.isArray(state.observed) ? state.observed[0] : undefined}
              playerCount={state.players.length}
            />
          </div>
          <div className={`side-body${sideTab === 'coach' ? '' : ' hide'}`}>
            <CoachPanel state={state} pendingAsk={pendingAsk} onAskConsumed={() => setPendingAsk(null)} />
          </div>
        </div>
      </div>

      {showGuide && <GuideModal onClose={() => setShowGuide(false)} />}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}

      {mode === null && (
        <div className="modal-backdrop">
          <div className="modal mode-select">
            <h2>🃏 게임 방식을 골라주세요</h2>
            {saved && (
              <button className="resume-banner" onClick={resumeSaved}>
                ▶ 이어서 하기 — {(saved.mode ?? 'tournament') === 'cash' ? '💵 캐시' : '🏆 토너먼트'} ·{' '}
                {saved.handNumber}핸드 · 내 칩 {fmt(saved.players[0]?.chips ?? 0)}
              </button>
            )}
            <div className="bot-count-row">
              <span>상대 봇 수</span>
              {[1, 2, 3, 4, 5].map(n => (
                <button
                  key={n}
                  className={`bot-count-btn${botCount === n ? ' active' : ''}`}
                  onClick={() => setBotCount(n)}
                >
                  {n}
                </button>
              ))}
              <small>{botCount === 1 ? '1:1 헤즈업!' : botCount >= 5 ? '풀 테이블 (템포 느림)' : ''}</small>
            </div>
            <div className="mode-cards">
              <button className="mode-card" onClick={() => pickMode('tournament')}>
                <span className="mode-emoji">🏆</span>
                <b>토너먼트</b>
                <p>블라인드가 6핸드마다 올라 갈수록 압박! 상대를 전부 탈락시키면 우승. 숏스택·엔드게임 연습에 좋아요.</p>
              </button>
              <button className="mode-card" onClick={() => pickMode('cash')}>
                <span className="mode-emoji">💵</span>
                <b>캐시 게임</b>
                <p>블라인드 고정, 파산한 봇 자리엔 새 손님(새 성향!)이 앉아요. 부담 없이 기본기를 반복 연습.</p>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
