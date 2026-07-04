import { useEffect, useRef, useState } from 'react'
import { GameState } from '../game/engine'
import { API_KEY_STORAGE, askCoach, buildGameContext, coachErrorMessage, CoachTurn } from '../game/coach'

interface ChatMsg {
  role: 'user' | 'assistant'
  text: string
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

  const send = async (q: string) => {
    const question = q.trim()
    if (!question || busy || !apiKey) return
    setInput('')
    const history: CoachTurn[] = messages.slice(-8).map(m => ({ role: m.role, content: m.text }))
    setMessages(prev => [...prev, { role: 'user', text: question }, { role: 'assistant', text: '' }])
    setBusy(true)
    try {
      const context = buildGameContext(state)
      await askCoach({
        apiKey,
        question,
        context,
        history,
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
        next[next.length - 1] = { role: 'assistant', text: errText }
        return next
      })
    } finally {
      setBusy(false)
    }
  }

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
          안녕하세요, 홀덤 코치예요! 🎓 게임 중 언제든 물어보세요. 지금 상황(내 카드, 승률, 추천)을 보고
          답해드릴게요.
        </div>
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            {m.text || <span className="chat-typing">생각 중…</span>}
          </div>
        ))}
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
