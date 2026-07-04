import { useEffect, useRef, useState } from 'react'
import { GameState } from '../game/engine'
import {
  API_KEY_STORAGE,
  askCoach,
  buildGameContext,
  buildHandReviewContext,
  coachErrorMessage,
  CoachTurn,
  HAND_REVIEW_QUESTION,
} from '../game/coach'

interface ChatMsg {
  role: 'user' | 'assistant'
  text: string
  hidden?: boolean // 자동 복기의 내부 요청문 — API 히스토리엔 포함, 화면엔 미표시
  kind?: 'review'
}

const QUICK_QUESTIONS = ['지금 뭘 해야 해?', '왜 그렇게 추천해?', '팟 오즈가 뭐야?']

export function CoachPanel({ state }: { state: GameState }) {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(API_KEY_STORAGE) ?? '')
  const [keyInput, setKeyInput] = useState('')
  const [showKeySetup, setShowKeySetup] = useState(false)
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight })
  }, [messages])

  const saveKey = () => {
    const key = keyInput.trim()
    if (!key) return
    localStorage.setItem(API_KEY_STORAGE, key)
    setApiKey(key)
    setKeyInput('')
    setShowKeySetup(false)
  }

  const clearKey = () => {
    localStorage.removeItem(API_KEY_STORAGE)
    setApiKey('')
  }

  const run = async (question: string, context: string, opts?: { hidden?: boolean; kind?: 'review' }) => {
    // 히스토리는 최근 6개만 — 매 호출 입력 토큰(비용)을 줄인다
    const history: CoachTurn[] = messages.slice(-6).map(m => ({ role: m.role, content: m.text }))
    setMessages(prev => [
      ...prev,
      { role: 'user', text: question, hidden: opts?.hidden },
      { role: 'assistant', text: '', kind: opts?.kind },
    ])
    setBusy(true)
    try {
      await askCoach({
        apiKey,
        question,
        context,
        history,
        mode: opts?.kind === 'review' ? 'review' : 'question',
        onDelta: chunk => {
          setMessages(prev => {
            const next = [...prev]
            const last = next[next.length - 1]
            next[next.length - 1] = { ...last, text: last.text + chunk }
            return next
          })
        },
      })
    } catch (e) {
      const errText = coachErrorMessage(e)
      setMessages(prev => {
        const next = [...prev]
        next[next.length - 1] = { ...next[next.length - 1], text: errText }
        return next
      })
    } finally {
      setBusy(false)
    }
  }

  const send = (q: string) => {
    const question = q.trim()
    if (!question || busy || !apiKey) return
    setInput('')
    void run(question, buildGameContext(state))
  }

  // 핸드가 끝나면 자동으로 복기 (참여한 핸드만, 핸드당 1회)
  const lastReviewed = useRef(0)
  useEffect(() => {
    if (state.phase === 'betting' || !apiKey || busy) return
    if (lastReviewed.current === state.handNumber) return
    lastReviewed.current = state.handNumber // 복기 생략 핸드도 재시도하지 않음
    const context = buildHandReviewContext(state)
    if (!context) return
    void run(HAND_REVIEW_QUESTION, context, { hidden: true, kind: 'review' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.handNumber, apiKey])

  if (!apiKey || showKeySetup) {
    return (
      <div className="coach-panel">
        <div className="coach-setup">
          <h4>🎓 AI 코치 연결하기</h4>
          <p>
            코치에게 자유롭게 질문하려면 Anthropic API 키가 필요해요.{' '}
            <a href="https://console.anthropic.com/" target="_blank" rel="noreferrer">
              console.anthropic.com
            </a>
            에서 발급할 수 있어요.
          </p>
          <input
            type="password"
            placeholder="sk-ant-..."
            value={keyInput}
            onChange={e => setKeyInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && saveKey()}
          />
          <button className="btn primary" onClick={saveKey} disabled={!keyInput.trim()}>
            저장하고 시작
          </button>
          <small>키는 이 브라우저(localStorage)에만 저장되고, Anthropic API 호출에만 쓰여요.</small>
          {apiKey && (
            <button className="coach-link-btn" onClick={() => setShowKeySetup(false)}>← 돌아가기</button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="coach-panel">
      <div className="coach-body" ref={bodyRef}>
        <div className="chat-msg assistant">
          안녕하세요, 홀덤 코치예요! 🎓 게임 중 언제든 물어보세요. 핸드가 끝나면 자동으로 짧은 복기도
          해드릴게요.
        </div>
        {messages.map((m, i) =>
          m.hidden ? null : (
            <div key={i} className={`chat-msg ${m.role}${m.kind === 'review' ? ' review' : ''}`}>
              {m.kind === 'review' && <div className="review-tag">📋 핸드 복기</div>}
              {m.text || <span className="chat-typing">생각 중…</span>}
            </div>
          ),
        )}
      </div>
      <div className="coach-quick">
        {QUICK_QUESTIONS.map(q => (
          <button key={q} disabled={busy} onClick={() => send(q)}>{q}</button>
        ))}
      </div>
      <div className="coach-input-row">
        <input
          type="text"
          placeholder="코치에게 질문하기…"
          value={input}
          disabled={busy}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send(input)}
        />
        <button className="btn coach-send" disabled={busy || !input.trim()} onClick={() => send(input)}>
          전송
        </button>
      </div>
      <div className="coach-foot">
        <button className="coach-link-btn" onClick={() => setShowKeySetup(true)}>키 변경</button>
        <button className="coach-link-btn" onClick={clearKey}>키 삭제</button>
      </div>
    </div>
  )
}
