// Farm system rankings: the industry's published editions (spring and after
// the deadline) plus a live view, with your own scouts' read beside each grade.
import { useState } from 'react';
import { useStore } from '../../store.ts';
import type { League, Player } from '../../core/types.ts';
import { editions, eta, industryFv, liveRankings, rookieEligible, type RankedOrg, type RankedProspect } from '../../core/farmRank.ts';
import { scoutedPot } from '../../core/ratings.ts';
import { posLabel } from '../../core/rules.ts';
import { orgPlayers } from '../../core/util.ts';
import { dayShort } from '../../core/settings.ts';
import { DataTable, OrgLink, Rating, type Column } from '../components.tsx';
import { nameCol } from '../fmt.tsx';
import { HeatIcon, TeamBadge } from '../show.tsx';

let viewPref = 'live';

const Move = ({ was, now }: { was?: number; now: number }) =>
  was === undefined ? <span className="muted">new</span> : was === now ? <span className="muted">–</span> : was > now ? <span className="pos">▲{was - now}</span> : <span className="neg">▼{now - was}</span>;

const FvChip = ({ fv }: { fv: number }) => <span className="fv-chip"><Rating v={Math.floor(fv)} />{fv % 5 !== 0 ? '+' : ''}</span>;

// One organization's top prospects (industry grade and your scouts' read).
function OrgTop({ league, orgId, keyNum }: { league: League; orgId: number; keyNum: number }) {
  const ps = orgPlayers(league, orgId).filter(rookieEligible).map((p) => ({ p, fv: industryFv(league, p, keyNum) })).sort((a, b) => b.fv - a.fv).slice(0, 10);
  return (
    <table className="data compact" style={{ maxWidth: 760, margin: '4px 0 10px' }}>
      <thead><tr><th>#</th><th className="l">Prospect</th><th>Pos</th><th>Age</th><th>Level</th><th title="Industry future value">FV</th><th title="Your scouts' read of his potential">Your read</th><th>ETA</th></tr></thead>
      <tbody>
        {ps.map(({ p, fv }, i) => (
          <tr key={p.id}><td>{i + 1}</td><td className="l"><a href={`#/player/${p.id}`}>{p.first} {p.last}</a><HeatIcon league={league} p={p} /></td><td>{posLabel(p)}</td><td>{league.season - p.born}</td><td>{p.level}</td><td><FvChip fv={fv} /></td><td><Rating v={scoutedPot(league, p)} /></td><td>{eta(league, p)}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

export default function FarmRankings() {
  const { league } = useStore();
  const [tab, setTab] = useState<'orgs' | 'top100'>('orgs');
  const [view, setViewState] = useState(viewPref);
  const [open, setOpen] = useState<number | null>(null);
  const setView = (v: string) => { viewPref = v; setViewState(v); };
  if (!league) return null;
  const eds = editions(league);
  const idx = view === 'live' ? -1 : Number(view);
  const ed = idx >= 0 ? eds[idx] : null;
  const keyNum = ed ? ed.season * 2 + (ed.label === 'Midseason' ? 1 : 0) : league.season * 2 + (league.phase === 'regular' && league.day > league.settings.tradeDeadlineDay ? 1 : 0);
  const live = ed ? null : liveRankings(league, keyNum);
  const orgs = ed ? ed.orgs : live!.orgs;
  const top100 = ed ? ed.top100 : live!.top100;
  // Movement: against the edition before this one (or the latest, for the live view).
  const prev = idx >= 0 ? eds[idx - 1] : eds[eds.length - 1];
  const prevOrg = new Map(prev?.orgs.map((o) => [o.orgId, o.rank]) ?? []);
  const prevPro = new Map(prev?.top100.map((r) => [r.pid, r.rank]) ?? []);
  const me = orgs.find((o) => o.orgId === league.userOrgId);

  const orgCols: Column<RankedOrg>[] = [
    { key: 'rank', label: '#', value: (o) => o.rank },
    { key: 'mv', label: 'Move', title: prev ? `Since the ${prev.season} ${prev.label.toLowerCase()} edition` : 'No earlier edition yet', value: (o) => (prevOrg.get(o.orgId) ?? o.rank) - o.rank, render: (o) => <Move was={prevOrg.get(o.orgId)} now={o.rank} /> },
    { key: 'org', label: 'Organization', left: true, value: (o) => league.orgs[o.orgId].name, render: (o) => <span className="nowrap"><TeamBadge league={league} orgId={o.orgId} size={22} /> <OrgLink league={league} orgId={o.orgId} level="MLB" /></span> },
    { key: 'score', label: 'Score', title: 'Talent in the system: top-heavy, like the real rankings (a 70 FV counts far more than a 50)', value: (o) => o.score, sortDesc: true },
    { key: 'top100', label: 'Top 100', value: (o) => o.top100, sortDesc: true },
    { key: 'fv50', label: '50+ FV', title: 'Prospects graded 50 or better: depth', value: (o) => o.fv50, sortDesc: true },
    { key: 'best', label: 'Top prospect', left: true, noSort: true, render: (o) => { const p = o.best !== null ? league.players[o.best] : null; return p ? <span className="nowrap"><a href={`#/player/${p.id}`}>{p.first} {p.last}</a> <span className="muted small">{posLabel(p)}, {p.level}</span></span> : '–'; } },
    { key: 'open', label: '', noSort: true, render: (o) => <button className="btn btn-sm" onClick={() => setOpen(open === o.orgId ? null : o.orgId)}>{open === o.orgId ? 'Hide' : 'Top 10'}</button> },
  ];
  type Row = RankedProspect & { p: Player };
  const rows: Row[] = top100.map((r) => ({ ...r, p: league.players[r.pid] })).filter((r) => r.p);
  const nc = nameCol(league);
  const proCols: Column<Row>[] = [
    { key: 'rank', label: '#', value: (r) => r.rank },
    { key: 'mv', label: 'Move', value: (r) => (prevPro.get(r.pid) ?? 101) - r.rank, render: (r) => <Move was={prevPro.get(r.pid)} now={r.rank} /> },
    { key: 'name', label: 'Name', left: true, value: (r) => r.p.last, render: (r) => nc.render!(r.p) },
    { key: 'pos', label: 'Pos', value: (r) => posLabel(r.p) },
    { key: 'age', label: 'Age', value: (r) => league.season - r.p.born },
    { key: 'org', label: 'Org', value: (r) => r.orgId, render: (r) => <OrgLink league={league} orgId={r.orgId} level={r.p.level ?? 'MLB'} abbrev /> },
    { key: 'lvl', label: 'Level', value: (r) => r.p.level ?? '' },
    { key: 'fv', label: 'FV', title: 'Industry future value (20-80): what he is expected to become', value: (r) => r.fv, sortDesc: true, render: (r) => <FvChip fv={r.fv} /> },
    { key: 'read', label: 'Your read', title: "Your scouts' read of his potential (a fresh scouting report sharpens it)", value: (r) => scoutedPot(league, r.p), sortDesc: true, render: (r) => <Rating v={scoutedPot(league, r.p)} /> },
    { key: 'eta', label: 'ETA', value: (r) => r.eta },
  ];
  return (
    <>
      <h1>Farm System Rankings</h1>
      <p className="muted small">
        The industry's rankings (think MLB Pipeline or Baseball America): every club's rookie-eligible prospects get a future value (FV) grade, the 20-80 level he's expected to reach, and systems are scored by their talent, weighted toward the top. New editions come out in spring and after the trade deadline. The grades are a consensus, close but not exact; "Your read" is your own scouts' view of his potential.
      </p>
      <div className="row-gap" style={{ marginBottom: 10 }}>
        <select value={view} onChange={(e) => setView(e.target.value)}>
          <option value="live">Live (right now)</option>
          {eds.map((e, i) => <option key={i} value={i}>{e.season} {e.label} ({dayShort(e.season, e.day)})</option>).reverse()}
        </select>
        <button className={`btn btn-sm${tab === 'orgs' ? ' active' : ''}`} onClick={() => setTab('orgs')}>Organizations</button>
        <button className={`btn btn-sm${tab === 'top100' ? ' active' : ''}`} onClick={() => setTab('top100')}>Top 100 prospects</button>
        {me && <span className="small">Your system: <b>No. {me.rank}</b> of {orgs.length} · {me.top100} in the top 100</span>}
      </div>
      {tab === 'orgs' ? (
        <>
          <DataTable rows={orgs} cols={orgCols} rowKey={(o) => o.orgId} defaultSort={{ key: 'rank', desc: false }} compact rowClass={(o) => (o.orgId === league.userOrgId ? 'user' : undefined)} />
          {open !== null && <><h3><TeamBadge league={league} orgId={open} size={24} /> {league.orgs[open].region} {league.orgs[open].name}: top 10</h3><OrgTop league={league} orgId={open} keyNum={keyNum} /></>}
        </>
      ) : (
        <DataTable rows={rows} cols={proCols} rowKey={(r) => r.pid} defaultSort={{ key: 'rank', desc: false }} compact rowClass={(r) => (r.orgId === league.userOrgId ? 'user' : undefined)} />
      )}
    </>
  );
}
