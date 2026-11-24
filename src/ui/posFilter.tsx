// Position filters and the diamond order for sorting (C, 1B, 2B, 3B, SS, LF,
// CF, RF, DH, then starters and relievers), shared by every player list.
import type { Player } from '../core/types.ts';
import { isPitcher } from '../core/ratings.ts';

const ORDER = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'OF', 'IF', 'UT', 'SP', 'RP'];
// Works on raw positions and on display labels like RHS / LHR.
export function posOrder(label: string): number {
  const l = String(label).toUpperCase();
  if (/^[RL]HS$/.test(l)) return ORDER.indexOf('SP');
  if (/^[RL]HR$/.test(l)) return ORDER.indexOf('RP');
  const i = ORDER.indexOf(l);
  return i < 0 ? 99 : i;
}

export const POS_FILTERS: Record<string, (p: Player) => boolean> = {
  all: () => true,
  hitters: (p) => !isPitcher(p),
  C: (p) => p.pos === 'C', '1B': (p) => p.pos === '1B', '2B': (p) => p.pos === '2B', '3B': (p) => p.pos === '3B', SS: (p) => p.pos === 'SS',
  IF: (p) => ['1B', '2B', '3B', 'SS'].includes(p.pos),
  LF: (p) => p.pos === 'LF', CF: (p) => p.pos === 'CF', RF: (p) => p.pos === 'RF',
  OF: (p) => ['LF', 'CF', 'RF'].includes(p.pos),
  DH: (p) => p.pos === 'DH',
  pitchers: isPitcher, SP: (p) => p.pos === 'SP', RP: (p) => p.pos === 'RP',
};
export const POS_LABELS: [string, string][] = [['all', 'All positions'], ['hitters', 'Hitters'], ['C', 'C'], ['1B', '1B'], ['2B', '2B'], ['3B', '3B'], ['SS', 'SS'], ['IF', 'Infield'], ['LF', 'LF'], ['CF', 'CF'], ['RF', 'RF'], ['OF', 'Outfield'], ['DH', 'DH'], ['pitchers', 'Pitchers'], ['SP', 'SP'], ['RP', 'RP']];
export const posFilterFn = (key: string) => POS_FILTERS[key] ?? (() => true);

export function PosFilterSelect({ value, onChange, small }: { value: string; onChange: (v: string) => void; small?: boolean }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={small ? 'small' : ''} title="Show only one position">
      {POS_LABELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
    </select>
  );
}
