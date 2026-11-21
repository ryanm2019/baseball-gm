// Shared column definitions and formatting.
import type { BatStats, League, Player, PitStats, Level } from '../core/types.ts';
import { avg, era, fip, fmt3, ipStr, obp, ops, slg, sumBat, sumPit, whip } from '../core/util.ts';
import { scoutedOvr, scoutedPot, isPitcher } from '../core/ratings.ts';
import { contractInfo, serviceLabel } from '../core/contracts.ts';
import { optionYearAvailable } from '../core/rules.ts';
import type { Column } from './components.tsx';
import { PlayerLink, Rating, StatusTags } from './components.tsx';

export const bt = (p: Player) => `${p.bats}/${p.throws}`;

export function seasonBat(p: Player, season: number, level?: Level): BatStats {
  return sumBat(p.stats.filter((s) => s.season === season && (!level || s.level === level)));
}

export function seasonPit(p: Player, season: number, level?: Level): PitStats {
  return sumPit(p.stats.filter((s) => s.season === season && (!level || s.level === level)));
}

export function optionsLeft(league: League, p: Player): string {
  if (!p.on40 && p.mlServiceDays === 0 && p.optionsUsed === 0) return '-';
  const left = Math.max(0, league.settings.optionYears - p.optionsUsed);
  if (left === 0 && !optionYearAvailable(league, p)) return 'Out';
  return String(left);
}

export function nameCol(league: League): Column<Player> {
  return {
    key: 'name',
    label: 'Name',
    left: true,
    value: (p) => `${p.last} ${p.first}`,
    render: (p) => (
      <>
        <PlayerLink p={p} />
        <StatusTags league={league} p={p} />
      </>
    ),
  };
}

export function ratingCols(league: League): Column<Player>[] {
  return [
    { key: 'ovr', label: 'Ovr', title: 'Overall (scouted, 20-80)', value: (p) => scoutedOvr(league, p), render: (p) => <Rating v={scoutedOvr(league, p)} /> },
    { key: 'pot', label: 'Pot', title: 'Potential (scouted, 20-80)', value: (p) => scoutedPot(league, p), render: (p) => <Rating v={scoutedPot(league, p)} /> },
  ];
}

export function batStatCols(get: (p: Player) => BatStats): Column<Player>[] {
  return [
    { key: 'g', label: 'G', value: (p) => get(p).g },
    { key: 'pa', label: 'PA', value: (p) => get(p).pa },
    { key: 'avg', label: 'AVG', value: (p) => avg(get(p)), render: (p) => fmt3(avg(get(p))) },
    { key: 'obp', label: 'OBP', value: (p) => obp(get(p)), render: (p) => fmt3(obp(get(p))) },
    { key: 'slg', label: 'SLG', value: (p) => slg(get(p)), render: (p) => fmt3(slg(get(p))) },
    { key: 'hr', label: 'HR', value: (p) => get(p).hr },
    { key: 'sb', label: 'SB', value: (p) => get(p).sb },
  ];
}

export function pitStatCols(get: (p: Player) => PitStats): Column<Player>[] {
  return [
    { key: 'pg', label: 'G', value: (p) => get(p).g },
    { key: 'gs', label: 'GS', value: (p) => get(p).gs },
    { key: 'ip', label: 'IP', value: (p) => get(p).outs, render: (p) => ipStr(get(p).outs) },
    { key: 'era', label: 'ERA', value: (p) => (get(p).outs ? era(get(p)) : 99), sortDesc: false, render: (p) => (get(p).outs ? era(get(p)).toFixed(2) : '-') },
    { key: 'k', label: 'K', value: (p) => get(p).k },
    { key: 'bb', label: 'BB', value: (p) => get(p).bb },
  ];
}

export function contractCols(league: League): Column<Player>[] {
  return [
    {
      key: 'contract',
      label: 'Contract',
      value: (p) => p.contract.salary,
      render: (p) =>
        p.contract.type === 'ML' ? (
          <ContractCell league={league} p={p} />
        ) : (
          <span className="muted">MiLB</span>
        ),
    },
    { key: 'svc', label: 'Svc', title: 'MLB service time (years.days)', value: (p) => p.mlServiceDays, render: (p) => serviceLabel(p.mlServiceDays, league.settings) },
    { key: 'opt', label: 'Opt', title: 'Option years remaining', value: (p) => optionsLeft(league, p), render: (p) => optionsLeft(league, p) },
  ];
}

export const statLine = (p: Player, b: BatStats, pt: PitStats) =>
  isPitcher(p)
    ? `${pt.w}-${pt.l}, ${pt.outs ? era(pt).toFixed(2) : '-'} ERA, ${ipStr(pt.outs)} IP, ${pt.k} K`
    : `${fmt3(avg(b))}/${fmt3(obp(b))}/${fmt3(slg(b))}, ${b.hr} HR, ${b.pa} PA`;

export { era, fip, whip, ops, fmt3, ipStr, avg, obp, slg };

// Contract with team control: "$0.8M · Pre-Arb · control thru 2032", "$25.0M thru 2031",
// and an orange "FA after" flag for anyone a free agent after this season.
export function ContractCell({ league, p, compact }: { league: League; p: Player; compact?: boolean }) {
  const c = contractInfo(league, p);
  if (c.minors) return <span className="muted" title={c.tip}>MiLB</span>;
  return (
    <span title={c.tip} className="nowrap">
      {compact ? c.compact : c.text}
      {c.faAfter !== null && <span className="tag tag-fa">{compact ? `FA '${String(c.faAfter).slice(2)}` : `FA after ${c.faAfter}`}</span>}
    </span>
  );
}
