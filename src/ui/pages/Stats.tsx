import { useStore } from '../../store.ts';
import { go, useRoute } from '../../router.ts';
import type { BatStats, Level, PitStats, Player } from '../../core/types.ts';
import { isPitcher } from '../../core/ratings.ts';
import { avg, era, fip, fmt3, ipStr, obp, slg, whip } from '../fmt.tsx';
import { DataTable, LevelTabs, OrgLink, type Column } from '../components.tsx';
import { emptyBat, emptyPit } from '../../core/util.ts';
import { LEVEL_NAMES } from '../../core/settings.ts';
import { nameCol } from '../fmt.tsx';

interface Row {
  p: Player;
  orgId: number;
  b: BatStats;
  s: PitStats;
}

export default function Stats() {
  const { league } = useStore();
  const route = useRoute();
  if (!league) return null;
  const level = (route.query.level ?? 'MLB') as Level;
  const type = route.query.type ?? 'bat';
  const scope = route.query.scope ?? 'all';
  const season = Number(route.query.season ?? league.season);
  const games = Math.max(...Object.values(league.standings[level]).map((r) => r.w + r.l), 1);

  const rows: Row[] = [];
  for (const p of Object.values(league.players)) {
    for (const e of p.stats) {
      if (e.season !== season || e.level !== level) continue;
      if (scope === 'mine' && e.orgId !== league.userOrgId) continue;
      if (type === 'bat' && e.bat.pa === 0) continue;
      if (type === 'pit' && e.pit.bf === 0) continue;
      rows.push({ p, orgId: e.orgId, b: e.bat ?? emptyBat(), s: e.pit ?? emptyPit() });
    }
  }
  const qualified = route.query.q !== '0';
  const minPA = Math.floor(games * 3.1);
  const minOuts = Math.floor(games * 3);
  const shown = rows.filter((r) => {
    if (!qualified) return true;
    if (type === 'bat') return r.b.pa >= minPA;
    return r.s.outs >= minOuts || (r.s.gs === 0 && r.s.g >= games * 0.3);
  });
  const nc = nameCol(league);
  const base: Column<Row>[] = [
    { key: 'name', label: 'Name', left: true, value: (r) => `${r.p.last} ${r.p.first}`, render: (r) => nc.render!(r.p) },
    { key: 'team', label: 'Team', left: true, value: (r) => league.orgs[r.orgId].abbrev, render: (r) => <OrgLink league={league} orgId={r.orgId} level={level} abbrev /> },
    { key: 'age', label: 'Age', value: (r) => season - r.p.born },
  ];
  const batCols: Column<Row>[] = [
    ...base,
    { key: 'pos', label: 'Pos', value: (r) => (isPitcher(r.p) ? 'P' : r.p.pos) },
    { key: 'g', label: 'G', value: (r) => r.b.g },
    { key: 'pa', label: 'PA', value: (r) => r.b.pa },
    { key: 'h', label: 'H', value: (r) => r.b.h },
    { key: 'd', label: '2B', value: (r) => r.b.d },
    { key: 't', label: '3B', value: (r) => r.b.t },
    { key: 'hr', label: 'HR', value: (r) => r.b.hr },
    { key: 'r', label: 'R', value: (r) => r.b.r },
    { key: 'rbi', label: 'RBI', value: (r) => r.b.rbi },
    { key: 'bb', label: 'BB', value: (r) => r.b.bb },
    { key: 'k', label: 'K', value: (r) => r.b.k },
    { key: 'sb', label: 'SB', value: (r) => r.b.sb },
    { key: 'cs', label: 'CS', value: (r) => r.b.cs },
    { key: 'avg', label: 'AVG', value: (r) => avg(r.b), render: (r) => fmt3(avg(r.b)) },
    { key: 'obp', label: 'OBP', value: (r) => obp(r.b), render: (r) => fmt3(obp(r.b)) },
    { key: 'slg', label: 'SLG', value: (r) => slg(r.b), render: (r) => fmt3(slg(r.b)) },
    { key: 'ops', label: 'OPS', value: (r) => obp(r.b) + slg(r.b), render: (r) => fmt3(obp(r.b) + slg(r.b)) },
    { key: 'kp', label: 'K%', value: (r) => (r.b.pa ? r.b.k / r.b.pa : 0), render: (r) => (r.b.pa ? ((r.b.k / r.b.pa) * 100).toFixed(1) : '-') },
    { key: 'bbp', label: 'BB%', value: (r) => (r.b.pa ? r.b.bb / r.b.pa : 0), render: (r) => (r.b.pa ? ((r.b.bb / r.b.pa) * 100).toFixed(1) : '-') },
  ];
  const pitCols: Column<Row>[] = [
    ...base,
    { key: 'w', label: 'W', value: (r) => r.s.w },
    { key: 'l', label: 'L', value: (r) => r.s.l },
    { key: 'era', label: 'ERA', value: (r) => era(r.s), sortDesc: false, render: (r) => era(r.s).toFixed(2) },
    { key: 'g', label: 'G', value: (r) => r.s.g },
    { key: 'gs', label: 'GS', value: (r) => r.s.gs },
    { key: 'sv', label: 'SV', value: (r) => r.s.sv },
    { key: 'hld', label: 'HLD', value: (r) => r.s.hld },
    { key: 'bs', label: 'BS', value: (r) => r.s.bs },
    { key: 'ip', label: 'IP', value: (r) => r.s.outs, render: (r) => ipStr(r.s.outs) },
    { key: 'h', label: 'H', value: (r) => r.s.h },
    { key: 'er', label: 'ER', value: (r) => r.s.er },
    { key: 'hr', label: 'HR', value: (r) => r.s.hr },
    { key: 'bb', label: 'BB', value: (r) => r.s.bb },
    { key: 'k', label: 'K', value: (r) => r.s.k },
    { key: 'whip', label: 'WHIP', value: (r) => whip(r.s), sortDesc: false, render: (r) => whip(r.s).toFixed(2) },
    { key: 'fip', label: 'FIP', value: (r) => fip(r.s), sortDesc: false, render: (r) => fip(r.s).toFixed(2) },
    { key: 'k9', label: 'K/9', value: (r) => (r.s.outs ? (r.s.k * 27) / r.s.outs : 0), render: (r) => (r.s.outs ? ((r.s.k * 27) / r.s.outs).toFixed(1) : '-') },
    { key: 'pit', label: 'Pit', value: (r) => r.s.pitches },
  ];
  const setQ = (q: Record<string, string>) => go('stats', [], { level, type, scope, q: qualified ? '1' : '0', season, ...q });
  const seasons = [...new Set(Object.values(league.players).flatMap((p) => p.stats.map((s) => s.season)))].sort();

  return (
    <>
      <h1>Player Stats <span className="muted small">{LEVEL_NAMES[level]} {season}</span></h1>
      <LevelTabs value={level} onChange={(v) => setQ({ level: v })} />
      <div className="form-row">
        <span className="btn-group">
          <button className={`btn btn-sm${type === 'bat' ? ' active' : ''}`} onClick={() => setQ({ type: 'bat' })}>Batting</button>
          <button className={`btn btn-sm${type === 'pit' ? ' active' : ''}`} onClick={() => setQ({ type: 'pit' })}>Pitching</button>
        </span>
        <span className="btn-group">
          <button className={`btn btn-sm${scope === 'all' ? ' active' : ''}`} onClick={() => setQ({ scope: 'all' })}>All teams</button>
          <button className={`btn btn-sm${scope === 'mine' ? ' active' : ''}`} onClick={() => setQ({ scope: 'mine' })}>My org</button>
        </span>
        <label>
          <input type="checkbox" checked={qualified} onChange={(e) => setQ({ q: e.target.checked ? '1' : '0' })} /> Qualified only
        </label>
        {seasons.length > 1 && (
          <select value={season} onChange={(e) => setQ({ season: e.target.value })}>
            {seasons.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
      </div>
      {type === 'bat' ? (
        <DataTable cols={batCols} rows={shown} rowKey={(r) => `${r.p.id}-${r.orgId}`} defaultSort={{ key: 'ops', desc: true }} rowClass={(r) => (r.orgId === league.userOrgId ? 'user' : undefined)} compact />
      ) : (
        <DataTable cols={pitCols} rows={shown} rowKey={(r) => `${r.p.id}-${r.orgId}`} defaultSort={{ key: qualified ? 'era' : 'ip', desc: !qualified }} rowClass={(r) => (r.orgId === league.userOrgId ? 'user' : undefined)} compact />
      )}
    </>
  );
}
