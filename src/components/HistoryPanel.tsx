import { useState } from 'react'
import { HandRecord } from '../game/types'

interface Props {
  history: HandRecord[]
  onAskCoach: (question: string) => void
}

export function HistoryPanel({ history, onAskCoach }: Props) {
  const [open, setOpen] = useState<number | null>(null)

  if (history.length === 0) {
    return (
      <div className="history-panel">
        <div className="history-empty">아직 끝난 핸드가 없어요.<br />첫 핸드를 쳐보세요! 🃏</div>
      </div>
    )
  }

  return (
    <div className="history-panel">
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
