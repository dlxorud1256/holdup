import { useEffect, useRef } from 'react'
import { LogEntry } from '../game/types'

export function LogPanel({ log }: { log: LogEntry[] }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight })
  }, [log.length])

  return (
    <div className="log-panel">
      <h3>📜 게임 기록</h3>
      <div className="log-body" ref={ref}>
        {log.map((e, i) => (
          <div key={i} className={`log-line ${e.kind}`}>{e.text}</div>
        ))}
      </div>
    </div>
  )
}
