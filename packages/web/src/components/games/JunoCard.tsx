import type { JunoCard as Card, JunoColor } from '@backspace/shared/src/juno';

export const JUNO_PALETTE: Record<JunoColor, string> = { coral: '#ec796e', amber: '#e9bd61', mint: '#73c8aa', sky: '#7daee2' };
const MARKS = { coral: 'M0 -5 L5 0 L0 5 L-5 0Z', amber: 'M0 -5 L5 4 L-5 4Z', mint: 'M-4 -4 H4 V4 H-4Z', sky: 'M-5 0 A5 5 0 1 0 5 0 A5 5 0 1 0 -5 0' };

/** Original scalable artwork. Names stay in the enclosing localized control. */
export function JunoCard({ card, back = false }: { card?: Card; back?: boolean }) {
  const color = card?.color ? JUNO_PALETTE[card.color] : '#b5a9ee';
  const face = !card || back ? 'J' : card.face === 'draw2' ? '+2' : card.face === 'draw4' ? '+4'
    : card.face === 'skip' ? '⊘' : card.face === 'reverse' ? '⇄' : card.face === 'wild' ? '✦' : card.face;
  return <svg className="juno-card-art" viewBox="0 0 100 146" aria-hidden="true" focusable="false">
    <rect x="1" y="1" width="98" height="144" rx="12" fill={back ? '#302c48' : color} stroke="#f4efe4" strokeWidth="2" />
    <path d="M18 112V34Q18 19 33 19H67Q82 19 82 34V112Q82 127 67 127H33Q18 127 18 112Z" fill="#20212c" />
    <path d="M21 113L79 33" stroke={color} strokeWidth="1" opacity=".35" />
    <text x="50" y="89" textAnchor="middle" fill={back ? '#e9e4ff' : color} fontSize={face.length > 1 ? 37 : 58} fontWeight="800" fontFamily="inherit">{face}</text>
    {card?.color && !back ? <>
      <path d={MARKS[card.color]} transform="translate(10 13)" fill="#20212c" />
      <path d={MARKS[card.color]} transform="translate(90 133)" fill="#20212c" />
    </> : <>
      <path d="M7 12h7M10.5 8.5v7M86 134h7M89.5 130.5v7" stroke={color} strokeWidth="2" />
      {!back && ['coral', 'amber', 'mint', 'sky'].map((c, i) => <rect key={c} x={28 + i * 12} y="108" width="8" height="5" rx="2" fill={JUNO_PALETTE[c as JunoColor]} />)}
    </>}
  </svg>;
}
