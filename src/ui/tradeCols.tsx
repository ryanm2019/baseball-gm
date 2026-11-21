// Player columns for trade screens: ratings (sortable by potential) and this
// season's production at every level he's played, each relative to that level.
import type { League, Level, Player } from '../core/types.ts';
import { avg, era, fmt3, ipStr, obp, slg, sumBat, sumPit } from '../core/util.ts';
import { isPitcher, scoutedOvr, scoutedPot } from '../core/ratings.ts';
import { contractInfo } from '../core/contracts.ts';
import { posLabel } from '../core/rules.ts';
import { batAdvanced, pitAdvanced, seasonCtx } from '../core/war.ts';
import { ContractCell } from './fmt.tsx';
import { Rating, type Column } from './components.tsx';

const LEVELS: Level[] = ['DSL', 'CPX', 'A', 'A+', 'AA', 'AAA', 'MLB'];

// The season whose numbers to show: last year's during spring training.
export const statsSeason = (league: League) => (league.phase === 'preseason' ? league.season - 1 : league.season);

export interface SeasonSummary {
  season: number;
  levels: Level[];
  n: number; // PA or batters faced
  line: string; // combined line across levels
  wrc: number | null; // PA-weighted wRC+ (each level vs its own average)
  fipm: number | null; // batters-faced-weighted FIP- (lower is better)
  tip: string; // the line at each level
}

const cache = new Map<string, SeasonSummary | null>();
export function seasonSummary(league: League, p: Player): SeasonSummary | null {
  const season = statsSeason(league);
  const es = p.stats.filter((s) => s.season === season);
  const key = `${league.id}:${league.day}:${league.phase}:${p.id}:${es.length}:${es.reduce((t, e) => t + e.bat.pa + e.pit.bf, 0)}`;
  if (cache.has(key)) return cache.get(key)!;
  if (cache.size > 5000) cache.clear();
  const levels = LEVELS.filter((l) => es.some((e) => e.level === l && (e.bat.pa > 0 || e.pit.bf > 0)));
  let out: SeasonSummary | null = null;
  if (levels.length) {
    const pit = isPitcher(p);
    let n = 0;
    let wsum = 0;
    const parts: string[] = [];
    for (const l of levels) {
      const at = es.filter((e) => e.level === l);
      const ctx = seasonCtx(league, season, l);
      if (pit) {
        const s = sumPit(at);
        if (!s.bf) continue;
        const f = pitAdvanced(s, ctx).fipMinus;
        n += s.bf;
        wsum += f * s.bf;
        parts.push(`${l}: ${era(s).toFixed(2)} ERA, ${ipStr(s.outs)} IP, ${s.k} K, ${s.bb} BB, FIP- ${f}`);
      } else {
        const b = sumBat(at);
        if (!b.pa) continue;
        const w = batAdvanced(b, ctx).wrcPlus;
        n += b.pa;
        wsum += w * b.pa;
        parts.push(`${l}: ${fmt3(avg(b))}/${fmt3(obp(b))}/${fmt3(slg(b))}, ${b.hr} HR, ${b.sb} SB, ${b.pa} PA, wRC+ ${w}`);
      }
    }
    if (n) {
      const all = es.filter((e) => levels.includes(e.level));
      const line = pit
        ? (() => { const s = sumPit(all); return `${era(s).toFixed(2)} ERA, ${ipStr(s.outs)} IP`; })()
        : (() => { const b = sumBat(all); return `${fmt3(avg(b))}/${fmt3(obp(b))}/${fmt3(slg(b))}, ${b.hr} HR`; })();
      out = {
        season, levels, n, line,
        wrc: pit ? null : Math.round(wsum / n),
        fipm: pit ? Math.round(wsum / n) : null,
        tip: `${season}\n${parts.join('\n')}`,
      };
    }
  }
  cache.set(key, out);
  return out;
}

export type TradeView = 'ratings' | 'stats';

// Pos, Age, Lvl, Ovr, Pot, then contract (ratings view) or this season's numbers (stats view).
export function tradePlayerCols(league: League, view: TradeView): Column<Player>[] {
  const base: Column<Player>[] = [
    { key: 'pos', label: 'Pos', value: (p) => posLabel(p) },
    { key: 'age', label: 'Age', value: (p) => league.season - p.born },
    { key: 'lvl', label: 'Lvl', value: (p) => LEVELS.indexOf(p.level ?? 'AAA'), render: (p) => p.level ?? '' },
    { key: 'ovr', label: 'Ovr', value: (p) => scoutedOvr(league, p), render: (p) => <Rating v={scoutedOvr(league, p)} />, sortDesc: true },
    { key: 'pot', label: 'Pot', value: (p) => scoutedPot(league, p), render: (p) => <Rating v={scoutedPot(league, p)} />, sortDesc: true },
  ];
  if (view === 'ratings') {
    return [...base, {
      key: 'contract', label: 'Contract', title: 'Salary and how long the club controls him (hover for details)',
      value: (p) => contractInfo(league, p).salary, render: (p) => <ContractCell league={league} p={p} compact />, sortDesc: true,
    }];
  }
  const sum = (p: Player) => seasonSummary(league, p);
  return [...base,
    { key: 'lvls', label: 'Levels', title: `Levels played in ${statsSeason(league)} (hover a row's line for each level)`, value: (p) => sum(p)?.levels.join(' ') ?? '', render: (p) => sum(p)?.levels.join(', ') ?? <span className="muted">-</span> },
    { key: 'n', label: 'PA/BF', title: 'Plate appearances (hitters) or batters faced (pitchers)', value: (p) => sum(p)?.n ?? 0, sortDesc: true },
    { key: 'wrc', label: 'wRC+', title: 'Runs created vs each level’s average (100 = average), weighted by PA', value: (p) => sum(p)?.wrc ?? -999, render: (p) => sum(p)?.wrc ?? '', sortDesc: true },
    { key: 'fipm', label: 'FIP-', title: 'FIP vs each level’s average (100 = average, lower is better), weighted by batters faced', value: (p) => sum(p)?.fipm ?? 999, render: (p) => sum(p)?.fipm ?? '' },
    { key: 'line', label: 'Line', left: true, noSort: true, render: (p) => { const s = sum(p); return s ? <span title={s.tip} style={{ cursor: 'help' }}>{s.line}</span> : <span className="muted">-</span>; } },
  ];
}
