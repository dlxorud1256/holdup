import { ReactNode } from 'react'
import { Card } from '../game/types'
import { cardKey } from '../game/deck'
import { CardView } from './CardView'

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="ghost-btn" onClick={onClose}>닫기 ✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

const c = (rank: number, suit: Card['suit']): Card => ({ rank, suit })

const GUIDE: { name: string; desc: string; cards: Card[] }[] = [
  { name: '로열 플러시', desc: '같은 무늬의 10·J·Q·K·A — 최강의 패!', cards: [c(10, 'h'), c(11, 'h'), c(12, 'h'), c(13, 'h'), c(14, 'h')] },
  { name: '스트레이트 플러시', desc: '같은 무늬로 숫자 5개가 연속', cards: [c(5, 's'), c(6, 's'), c(7, 's'), c(8, 's'), c(9, 's')] },
  { name: '포카드', desc: '같은 숫자 4장', cards: [c(9, 's'), c(9, 'h'), c(9, 'd'), c(9, 'c'), c(13, 's')] },
  { name: '풀 하우스', desc: '트리플 + 원 페어', cards: [c(12, 's'), c(12, 'h'), c(12, 'd'), c(7, 's'), c(7, 'h')] },
  { name: '플러시', desc: '같은 무늬 5장 (숫자 무관)', cards: [c(2, 'h'), c(6, 'h'), c(9, 'h'), c(11, 'h'), c(13, 'h')] },
  { name: '스트레이트', desc: '숫자 5개가 연속 (무늬 무관)', cards: [c(4, 's'), c(5, 'h'), c(6, 'd'), c(7, 'c'), c(8, 's')] },
  { name: '트리플', desc: '같은 숫자 3장', cards: [c(8, 's'), c(8, 'h'), c(8, 'd'), c(14, 's'), c(13, 'd')] },
  { name: '투 페어', desc: '페어가 2개', cards: [c(11, 's'), c(11, 'h'), c(4, 'd'), c(4, 'c'), c(14, 's')] },
  { name: '원 페어', desc: '같은 숫자 2장', cards: [c(10, 's'), c(10, 'h'), c(14, 'd'), c(13, 'c'), c(3, 's')] },
  { name: '하이 카드', desc: '아무 조합도 없을 때 — 가장 높은 카드로 승부', cards: [c(14, 's'), c(11, 'h'), c(8, 'd'), c(5, 'c'), c(2, 's')] },
]

export function GuideModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="📖 족보표 (위가 가장 강해요)" onClose={onClose}>
      {GUIDE.map((g, i) => (
        <div className="guide-row" key={g.name}>
          <span className="guide-rank">{i + 1}</span>
          <span className="guide-name">{g.name}</span>
          <div className="guide-cards">
            {g.cards.map(card => <CardView key={cardKey(card)} card={card} small />)}
          </div>
          <span className="guide-desc">{g.desc}</span>
        </div>
      ))}
    </Modal>
  )
}

export function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="❓ 홀덤, 이렇게 하면 돼요" onClose={onClose}>
      <div className="help-body">
        <h3>🎯 목표</h3>
        <p>
          내 카드 <b>2장</b> + 테이블 가운데 공용 카드 <b>5장</b>, 총 7장 중에서 가장 강한{' '}
          <b>5장 조합(족보)</b>을 만든 사람이 판돈(팟)을 가져가요.
        </p>
        <h3>🔄 진행 순서</h3>
        <ol>
          <li><b>프리플랍</b> — 내 카드 2장을 받고 첫 베팅</li>
          <li><b>플랍</b> — 공용 카드 3장 공개 후 베팅</li>
          <li><b>턴</b> — 공용 카드 1장 추가 후 베팅</li>
          <li><b>리버</b> — 마지막 1장 추가 후 베팅</li>
          <li><b>쇼다운</b> — 남은 사람끼리 패를 공개해 승자 결정!</li>
        </ol>
        <h3>🎮 내가 할 수 있는 행동</h3>
        <ul>
          <li><b>체크</b> — 아무도 베팅 안 했을 때, 돈 없이 차례 넘기기</li>
          <li><b>콜</b> — 상대가 베팅한 만큼 따라서 내기</li>
          <li><b>레이즈</b> — 상대 베팅보다 더 크게 올리기</li>
          <li><b>폴드</b> — 이번 판 포기 (지금까지 낸 돈은 돌려받지 못해요)</li>
        </ul>
        <h3>💰 블라인드란?</h3>
        <p>
          매 판 두 명이 의무로 내는 참가비예요 (스몰 50 / 빅 100). 차례는 매 판 시계 방향으로
          돌아가요. <b>D</b> 배지가 딜러 버튼이에요.
        </p>
        <h3>💡 초보자 팁</h3>
        <ul>
          <li>막히면 <b>💡 힌트</b> 버튼을 누르세요 — 추천 행동과 이유를 알려줘요.</li>
          <li><b>📖 족보표</b>는 언제든 열어볼 수 있어요.</li>
          <li>내 카드 옆 <b>현재 족보</b>를 확인하세요. 금색 테두리 카드가 내 최고 조합이에요.</li>
          <li>약한 패로 큰 베팅을 따라가지 않는 것이 홀덤의 기본이에요!</li>
        </ul>
      </div>
    </Modal>
  )
}
