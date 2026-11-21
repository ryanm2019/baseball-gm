// Stat cells for the Depth Chart: this season's numbers at the chart's level
// (or last season's), so lineup and bullpen calls aren't made on ratings alone.
import type { BatStats, League, Level, PitStats, Player, StatEntry } from '../core/types.ts';
import { emptyBat, emptyPit, era, fmt3, ipStr, obp, ops, slg, avg, sumBat, sumPit } from '../core/util.ts';
import { batAdvanced, pitAdvanced, seasonCtx } from '../core/war.ts';

export type StatWhen = 'this' | 'last';

// The season to show: this one in season, the one just played over the winter.
export function depthSeason(league: League, when: StatWhen): number {
  const cur = league.phase === 'preseason' ? league.season - 1 : league.season;
  return when === 'last' ? cur - 1 : cur;
}

const entries = (p: Player, season: number, level: Level): StatEntry[] => p.stats.filter((s) => s.season === season && s.level === level);

function splitBat(p: Player, season: number, level: Level, key: string): BatStats {
  const t = emptyBat();
  for (const e of entries(p, season, level)) {
    const s = e.splits?.bat?.[key] as Partial<BatStats> | undefined;
    if (s) for (const k of Object.keys(t) as (keyof BatStats)[]) t[k] += s[k] ?? 0;
  }
  return t;
}

const dash = <span className="muted">-</span>;

export const HIT_HEAD = (vs: 'L' | 'R') => (
  <>
    <th title="Plate appearances">PA</th>
    <th title="AVG / OBP / SLG">Slash</th>
    <th>HR</th>
    <th title="Runs created vs his level (100 = average)">wRC+</th>
    <th title={`OPS against ${vs === 'R' ? 'right' : 'left'}-handed pitching (PA in the tooltip)`}>vs {vs}HP</th>
  </>
);

export function HitCells({ league, p, level, season, vs }: { league: League; p: Player; level: Level; season: number; vs: 'L' | 'R' }) {
  const b = sumBat(entries(p, season, level));
  if (!b.pa) return <><td>{dash}</td><td>{dash}</td><td>{dash}</td><td>{dash}</td><td>{dash}</td></>;
  const ctx = seasonCtx(league, season, level);
  const sp = splitBat(p, season, level, vs === 'R' ? 'vsR' : 'vsL');
  return (
    <>
      <td>{b.pa}</td>
      <td className="nowrap">{fmt3(avg(b))}/{fmt3(obp(b))}/{fmt3(slg(b))}</td>
      <td>{b.hr}</td>
      <td>{Math.round(batAdvanced(b, ctx).wrcPlus)}</td>
      <td title={`${sp.pa} PA vs ${vs}HP`}>{sp.pa ? fmt3(ops(sp)) : dash}</td>
    </>
  );
}

export const PIT_HEAD = (
  <>
    <th>G</th>
    <th>IP</th>
    <th>ERA</th>
    <th>FIP</th>
    <th title="Strikeout rate minus walk rate">K-BB%</th>
    <th title="Saves / holds">SV/HLD</th>
    <th title="Appearances in the last 7 days (rest)">7d</th>
  </>
);

export function PitCells({ league, p, level, season }: { league: League; p: Player; level: Level; season: number }) {
  const s = sumPit(entries(p, season, level));
  const recent = (p.recentApps ?? []).filter((d) => d > league.day - 7 && d <= league.day).length;
  if (!s.bf) return <><td>{dash}</td><td>{dash}</td><td>{dash}</td><td>{dash}</td><td>{dash}</td><td>{dash}</td><td>{recent || ''}</td></>;
  const adv = pitAdvanced(s, seasonCtx(league, season, level));
  return (
    <>
      <td>{s.g}</td>
      <td>{ipStr(s.outs)}</td>
      <td>{era(s).toFixed(2)}</td>
      <td>{adv.fip.toFixed(2)}</td>
      <td>{(adv.kbb * 100).toFixed(1)}</td>
      <td>{s.sv}/{s.hld}</td>
      <td className={recent >= 3 ? 'neg' : ''}>{recent || ''}</td>
    </>
  );
}

// One line for a starter: GS, IP, ERA, FIP, K-BB%.
export function StarterLine({ league, p, level, season }: { league: League; p: Player; level: Level; season: number }) {
  const s: PitStats = p ? sumPit(entries(p, season, level)) : emptyPit();
  if (!s.bf) return <span className="muted small">No {season} stats at this level</span>;
  const adv = pitAdvanced(s, seasonCtx(league, season, level));
  return (
    <span className="small">
      {s.gs} GS · {ipStr(s.outs)} IP · <b>{era(s).toFixed(2)}</b> ERA · {adv.fip.toFixed(2)} FIP · {(adv.kbb * 100).toFixed(1)} K-BB%
    </span>
  );
}
