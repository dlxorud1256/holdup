import { useState } from 'react'
import { HandRecord, ObservedStats } from '../game/types'

interface Props {
  history: HandRecord[]
  onAskCoach: (question: string) => void
  stats?: ObservedStats
  playerCount: number
}

// 누적 순손익 스파크라인 (라이브러리 없이 SVG)
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null
  const w = 78
  const h = 22
  const min = Math.min(...values, 0)
  const max = Math.max(...values, 0)
  const range = max - min || 1
  const pts = values
    .map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - ((v - min) / range) * h).toFixed(1)}`)
    .join(' ')
  return (
    <svg width={w} height={h} className="spark" aria-hidden>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

// 테이블 인원수에 따른 적정 참여율(VPIP) 범위 — 인원이 적을수록 넓게 치는 게 정상
function vpipRange(playerCount: number): [number, number] {
  if (playerCount <= 2) return [60, 90]
  if (playerCount <= 4) return [28, 45]
  return [20, 35]
}

export function HistoryPanel({ history, onAskCoach, stats, playerCount }: Props) {
  const [open, setOpen] = useState<number | null>(null)

  if (history.length === 0) {
    return (
      <div className="history-panel">
        <div className="history-empty">아직 끝난 핸드가 없어요.<br />첫 핸드를 쳐보세요! 🃏</div>
      </div>
    )
  }

  const net = history.reduce((s, h) => s + h.myNet, 0)
  const cumulative = history.reduce<number[]>((acc, h) => {
    acc.push((acc[acc.length - 1] ?? 0) + h.myNet)
    return acc
  }, [])
  const vpip = stats && (stats.handsDealt ?? 0) > 0
    ? Math.round(((stats.handsVoluntary ?? 0) / stats.handsDealt) * 100)
    : null
  const [lo, hi] = vpipRange(playerCount)
  const vpipClass = vpip === null ? '' : vpip > hi ? 'warn' : vpip < lo ? 'cold' : 'ok'

  return (
    <div className="history-panel">
      <div className="session-stats">
        <div>
          📊 {history.length}핸드
          {vpip !== null && (
            <>
              {' · '}참여율 <b className={`vpip ${vpipClass}`}>{vpip}%</b>
              <small> (적정 {lo}~{hi}%)</small>
            </>
          )}
        </div>
        <div className={`session-net${net > 0 ? ' pos' : net < 0 ? ' neg' : ''}`}>
          순손익 <b>{net > 0 ? '+' : ''}{net.toLocaleString('ko-KR')}</b>
          <Sparkline values={cumulative} />
        </div>
      </div>
      <div className="history-body">
        {[...history].reverse().map(h => (
          <div key={h.handNumber} className="history-item">
            <button
              className="history-head"
              onClick={() => setOpen(open === h.handNumber ? null : h.handNumber)}
            >
              <span className="history-no">#{h.handNumber}</span>
              <span className={`history-net${h.myNet > 0 ? ' pos' : h.myNet < 0 ? ' neg' : ''}`}>
                {h.myNet > 0 ? '+' : ''}{h.myNet.toLocaleString('ko-KR')}
              </span>
              <span className="history-sum">
                {h.myFolded ? '폴드 · ' : ''}{h.winners.split(',')[0] || '-'}
              </span>
            </button>
            {open === h.handNumber && (
              <div className="history-detail">
                <div className="history-meta">
                  내 카드 <b>{h.myCards || '-'}</b> · 보드 <b>{h.board || '(프리플랍 종료)'}</b>
                </div>
                <div className="history-lines">
                  {h.lines.map((l, i) => (
                    <div key={i}>{l}</div>
                  ))}
                </div>
                <button
                  className="coach-link-btn"
                  onClick={() =>
                    onAskCoach(
                      `핸드 #${h.handNumber}을(를) 복기해줘. 잘한 점과 아쉬운 점을 짚어줘.\n` +
                      `[핸드 기록]\n${h.lines.join('\n')}\n` +
                      `내 카드: ${h.myCards || '없음'} / 내 순손익: ${h.myNet.toLocaleString('ko-KR')}`,
                    )
                  }
                >
                  🎓 이 핸드 코치에게 묻기
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
