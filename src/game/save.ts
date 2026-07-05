import { GameState } from './engine'

// 진행 상태 저장/복원 (localStorage) — 새로고침·탭 닫기에도 게임이 유리잔처럼 깨지지 않게.
// GameState 스키마가 바뀌는 커밋에서는 SAVE_VERSION을 올려서 옛 저장본을 조용히 폐기한다.
const SAVE_KEY = 'holdup_save'
const SAVE_VERSION = 1

export function saveGame(state: GameState) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ v: SAVE_VERSION, at: Date.now(), state }))
  } catch {
    // 저장 실패(용량 등)는 게임 진행에 치명적이지 않으므로 무시
  }
}

export function loadGame(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as { v?: number; state?: GameState }
    if (data?.v !== SAVE_VERSION) return null
    const s = data.state
    if (!s || !Array.isArray(s.players) || s.players.length < 2 || !s.players[0]?.isHuman) return null
    if (!Array.isArray(s.log) || typeof s.handNumber !== 'number') return null
    return s
  } catch {
    return null
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY)
  } catch {
    // 무시
  }
}
