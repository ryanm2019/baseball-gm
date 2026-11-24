import { useState } from 'react';
import { PosFilterSelect, posFilterFn } from '../posFilter.tsx';
import { useStore } from '../../store.ts';
import { go, useRoute } from '../../router.ts';
import type { Player } from '../../core/types.ts';
import { scoutedOvr, scoutedPot } from '../../core/ratings.ts';
import { posLabel } from '../../core/rules.ts';
import { DataTable, OrgLink, type Column } from '../components.tsx';
import { nameCol, ratingCols, seasonBat, seasonPit, statLine } from '../fmt.tsx';

// Prospects: players who have not exhausted rookie status (fewer than ~45 days of MLB service).
let prospectPos = 'all';

export default function Prospects() {
  const { league } = useStore();
  const route = useRoute();
  const [pf, setPfState] = useState(prospectPos);
  const setPf = (v: string) => { prospectPos = v; setPfState(v); };
  if (!league) return null;
  const mine = route.query.scope === 'mine';
  const list = Object.values(league.players)
    .filter((p) => p.orgId !== null && p.mlServiceDays < 45 && p.level !== 'MLB' && (!mine || p.orgId === league.userOrgId))
    .map((p) => ({ p, v: scoutedPot(league, p) * 0.75 + scoutedOvr(league, p) * 0.25 - (league.season - p.born) * 0.15 }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 100)
    .map((x, i) => ({ ...x, rank: i + 1 }))
    .filter((r) => posFilterFn(pf)(r.p));
  type Row = (typeof list)[0];
  const nc = nameCol(league);
  const rc = ratingCols(league);
  const cols: Column<Row>[] = [
    { key: 'rank', label: '#', value: (r) => r.rank, sortDesc: false },
    { key: 'name', label: 'Name', left: true, value: (r) => r.p.last, render: (r) => nc.render!(r.p) },
    { key: 'org', label: 'Org', left: true, value: (r) => r.p.orgId!, render: (r) => <OrgLink league={league} orgId={r.p.orgId} level={r.p.level ?? 'MLB'} abbrev /> },
    { key: 'lvl', label: 'Level', value: (r) => r.p.level ?? '' },
    { key: 'pos', label: 'Pos', value: (r) => posLabel(r.p) },
    { key: 'age', label: 'Age', value: (r) => league.season - r.p.born },
    ...rc.map((c) => ({ ...c, value: (r: Row) => c.value!(r.p), render: (r: Row) => c.render!(r.p) }) as Column<Row>),
    { key: 'line', label: 'This season', left: true, noSort: true, render: (r: Row) => <span className="small">{statLine(r.p as Player, seasonBat(r.p, league.season), seasonPit(r.p, league.season))}</span> },
  ];
  return (
    <>
      <h1>Top 100 Prospects</h1>
      <div className="btn-group tabs">
        <button className={`btn btn-sm${!mine ? ' active' : ''}`} onClick={() => go('prospects')}>League</button>
        <button className={`btn btn-sm${mine ? ' active' : ''}`} onClick={() => go('prospects', [], { scope: 'mine' })}>My organization</button>
      </div>
      <p className="muted small">Ranked by your scouts' view of potential, current ability and age. <PosFilterSelect value={pf} onChange={setPf} /></p>
      <DataTable cols={cols} rows={list} rowKey={(r) => r.p.id} defaultSort={{ key: 'rank', desc: false }} rowClass={(r) => (r.p.orgId === league.userOrgId ? 'user' : undefined)} compact />
    </>
  );
}
