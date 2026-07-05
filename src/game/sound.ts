// 효과음: 오디오 파일 없이 WebAudio로 즉석 합성 (번들 크기 0 추가)
// 브라우저 정책상 사용자 제스처 전에는 소리가 나지 않지만, 조용히 무시되므로 안전하다.

const MUTE_STORAGE = 'holdup_muted'

let ctx: AudioContext | null = null
let muted = typeof localStorage !== 'undefined' && localStorage.getItem(MUTE_STORAGE) === '1'

export function isMuted(): boolean {
  return muted
}

export function setMuted(m: boolean) {
  muted = m
  localStorage.setItem(MUTE_STORAGE, m ? '1' : '0')
}

function ac(): AudioContext | null {
  if (muted) return null
  try {
    ctx = ctx ?? new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
    return ctx
  } catch {
    return null
  }
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, when = 0) {
  const c = ac()
  if (!c) return
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = type
  o.frequency.value = freq
  g.gain.setValueAtTime(vol, c.currentTime + when)
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + when + dur)
  o.connect(g)
  g.connect(c.destination)
  o.start(c.currentTime + when)
  o.stop(c.currentTime + when + dur + 0.02)
}

function noise(dur: number, vol: number, when = 0, freq = 1200) {
  const c = ac()
  if (!c) return
  const len = Math.max(1, Math.floor(c.sampleRate * dur))
  const buf = c.createBuffer(1, len, c.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len)
  const src = c.createBufferSource()
  src.buffer = buf
  const f = c.createBiquadFilter()
  f.type = 'bandpass'
  f.frequency.value = freq
  const g = c.createGain()
  g.gain.value = vol
  src.connect(f)
  f.connect(g)
  g.connect(c.destination)
  src.start(c.currentTime + when)
}

export const sfx = {
  deal() {
    // 카드 스륵-스륵
    noise(0.05, 0.12, 0, 2600)
    noise(0.05, 0.09, 0.08, 2200)
  },
  chip() {
    // 칩 잘그락
    tone(1750, 0.05, 'triangle', 0.09)
    tone(1350, 0.07, 'triangle', 0.08, 0.05)
  },
  check() {
    // 테이블 톡톡 (노크)
    noise(0.07, 0.18, 0, 420)
  },
  fold() {
    // 카드 스윽 (덮기)
    noise(0.16, 0.06, 0, 850)
  },
  win() {
    // 짧은 상승 아르페지오
    tone(660, 0.12, 'sine', 0.1)
    tone(880, 0.12, 'sine', 0.1, 0.1)
    tone(1108, 0.22, 'sine', 0.1, 0.2)
  },
}
