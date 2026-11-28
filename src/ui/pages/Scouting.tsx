// Scouting: the director's monthly plan, your scouts' workload, and every
// report on file. Reports sharpen your read on a player for months.
import { useState } from 'react';
import { changed, setMessage, useStore } from '../../store.ts';
import type { League, Player, ScoutMode, ScoutReport, StaffRole } from '../../core/types.ts';
import { reportAgeDays, requestReport, scouting, scoutName, scoutPlan, visitsPerMonth } from '../../core/scouting.ts';
import { DataTable, Rating, type Column } from '../components.tsx';
import { nameCol } from '../fmt.tsx';
import { dayShort } from '../../core/settings.ts';
import { posLabel } from '../../core/rules.ts';
import { href, useRoute } from '../../router.ts';

const MODES: { key: ScoutMode; label: string }[] = [
  { key: 'auto', label: 'Auto (follows the club)' },
  { key: 'buying', label: 'Buying: scout big league rosters' },
  { key: 'selling', label: "Selling: scout contenders' farms" },
  { key: 'balanced', label: 'Balanced' },
];
const ROLES: StaffRole[] = ['SD', 'PRO', 'AMA', 'INT', 'ICS'];
const ROLE_LABEL: Record<string, string> = { SD: 'Scouting director', PRO: 'Pro scout', AMA: 'Amateur department', INT: 'International department', ICS: 'Internal coverage scout' };

export function riskClass(r: ScoutReport['risk']): string {
  return r === 'Low' ? 'pos' : r === 'Medium' ? '' : 'neg';
}

// A table column with your scouts' written report: projected role and risk
// (hover for the write-up). Sorts by the report's future grade.
export function reportCol(league: League): Column<Player> {
  const rep = (p: Player) => league.scouting?.reports[p.id];
  return {
    key: 'report', label: 'Report', left: true, title: "Your scouts' written report: projected role and risk (hover for the write-up)",
    value: (p) => rep(p)?.pot ?? -1, sortDesc: true,
    render: (p) => { const r = rep(p); return r ? <span className="small nowrap" title={`${r.text} (${scoutName(league, r.by)}, ${dayShort(r.season, r.day)})`}>{r.role} · <span className={riskClass(r.risk)}>{r.risk}</span></span> : <span className="muted small">none</span>; },
  };
}

// A report card for the player page (and anywhere else a report is useful).
export function ReportCard({ league, p }: { league: League; p: Player }) {
  const r = league.scouting?.reports[p.id];
  const own = p.orgId === league.userOrgId;
  return (
    <div className="box report-card">
      <div className="rc-head">
        <h3 style={{ margin: 0 }}>{own ? 'Internal coverage report' : 'Scouting report'}</h3>
        <span className="nowrap">
          <button className="btn btn-sm" onClick={() => { setMessage(requestReport(league, p.id, false)); changed(); }}>Request a look</button>{' '}
          <button className="btn btn-sm btn-primary" onClick={() => { setMessage(requestReport(league, p.id, true)); changed(); }}>Rush report</button>
        </span>
      </div>
      {!r ? <p className="muted small">No report on file. {own ? (league.orgs[league.userOrgId].staff.ICS === undefined ? 'Hire an internal coverage scout on the Staff page: without one, coverage of your system is thin. ' : 'Your internal coverage scout writes up your top prospects and 40-man every couple of months. ') : ''}Request a look (next month's list) or rush one (back in a day or two).</p> : (
        <>
          <div className="rc-meta">
            <b>{r.role}</b> · <span className={riskClass(r.risk)}>{r.risk} risk</span> · read <Rating v={r.ovr} /> now, <Rating v={r.pot} /> future
            <span className="muted small"> · {scoutName(league, r.by)}, {dayShort(r.season, r.day)}{r.visits > 1 ? ` · ${r.visits} looks` : ''}{reportAgeDays(league, r) > 180 ? ' · getting stale' : ''}</span>
          </div>
          <div className="rc-tools">{r.tools.map((t) => <span key={t.label}>{t.label} <Rating v={t.v} /></span>)}</div>
          <p className="small" style={{ margin: '6px 0 0' }}>{r.text}</p>
          <p className="muted small" style={{ margin: '2px 0 0' }}>Why we looked: {r.why}.</p>
        </>
      )}
    </div>
  );
}

export default function Scouting() {
  const { league } = useStore();
  const route = useRoute();
  const [filter, setFilter] = useState<'all' | 'pro' | 'ours' | 'draft' | 'intl' | 'mine'>((route.query.tab as 'ours') ?? 'all');
  if (!league) return null;
  const st = scouting(league);
  const plan = scoutPlan(league);
  const reports = Object.values(st.reports).filter((r) => league.players[r.pid] && !league.players[r.pid].retired);
  const shown = reports.filter((r) => {
    const p = league.players[r.pid];
    if (filter === 'draft') return !!p.prospect && p.orgId === null;
    if (filter === 'intl') return !!p.ifa && p.orgId === null;
    if (filter === 'pro') return p.orgId !== null && p.orgId !== league.userOrgId;
    if (filter === 'ours') return p.orgId === league.userOrgId;
    if (filter === 'mine') return /asked|rushed/.test(r.why);
    return true;
  });
  const rows = shown.map((r) => league.players[r.pid]);
  const rep = (p: Player) => st.reports[p.id];
  const cols: Column<Player>[] = [
    nameCol(league),
    { key: 'pos', label: 'Pos', value: (p) => posLabel(p) },
    { key: 'age', label: 'Age', value: (p) => league.season - p.born },
    { key: 'team', label: 'Team', value: (p) => (p.orgId !== null ? `${league.orgs[p.orgId].abbrev} ${p.level}` : p.prospect ? 'Draft' : p.ifa ? 'Intl' : 'FA') },
    { key: 'ovr', label: 'Now', title: 'Ovr as your scouts read him (when filed)', value: (p) => rep(p).ovr, sortDesc: true },
    { key: 'pot', label: 'Future', title: 'Potential as your scouts read him', value: (p) => rep(p).pot, sortDesc: true },
    { key: 'role', label: 'Projection', left: true, value: (p) => rep(p).role },
    { key: 'risk', label: 'Risk', value: (p) => ['Low', 'Medium', 'High', 'Extreme'].indexOf(rep(p).risk), render: (p) => <span className={riskClass(rep(p).risk)}>{rep(p).risk}</span> },
    { key: 'text', label: 'Report', left: true, noSort: true, render: (p) => <span className="small" style={{ whiteSpace: 'normal', display: 'block', minWidth: 260, maxWidth: 420 }} title={`Why we looked: ${rep(p).why}`}>{rep(p).text}</span> },
    { key: 'by', label: 'Scout', value: (p) => rep(p).by },
    { key: 'day', label: 'Filed', value: (p) => (rep(p).season - league.season) * 365 + rep(p).day, sortDesc: true, render: (p) => dayShort(rep(p).season, rep(p).day) },
  ];
  const planned = (role: StaffRole) => st.plan.filter((x) => x.by === role).length;
  return (
    <>
      <h1>Scouting</h1>
      <p className="muted small">
        Each month your scouting director sends every scout out on a set number of looks. When you're buying, the pro scout works other clubs' big league rosters at your weak spots; when you're selling, he works the farm systems of the contenders you'd trade with. The amateur department covers the draft class from the spring until the draft (around 200 reports) and the international department the new class until signing day (around 100); in between they cover the low minors. Your internal coverage scout writes up your own system. Every look files a report that sharpens your read on that player for months (a second look sharpens it more). Ask for a look or rush a report from any player's page, or rush reports on the players in a trade from the Trade page.
      </p>
      <div className="box" style={{ maxWidth: 900 }}>
        <div className="row-gap">
          <b>Director's plan:</b>{' '}
          <select value={st.mode} onChange={(e) => { st.mode = e.target.value as ScoutMode; st.month = ''; changed(); }}>
            {MODES.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>{' '}
          <span className="muted small">Now: <b>{plan.mode}</b> ({plan.why}). Changing it re-plans this month.</span>
        </div>
        <table className="data compact" style={{ marginTop: 8 }}>
          <thead><tr><th className="l">Scout</th><th className="l">Role</th><th>Looks / month</th><th>Still to do this month</th></tr></thead>
          <tbody>
            {ROLES.map((r) => <tr key={r}><td className="l">{scoutName(league, r)}</td><td className="l">{ROLE_LABEL[r]}</td><td>{visitsPerMonth(league, r)}</td><td>{planned(r)}</td></tr>)}
          </tbody>
        </table>
        {(st.rush.length > 0 || st.requests.length > 0) && (
          <p className="small" style={{ marginBottom: 0 }}>
            {st.rush.length > 0 && <>Rushing: {st.rush.map((r) => <span key={r.pid}><a href={href('player', [r.pid])}>{league.players[r.pid]?.last}</a> (by {dayShort(league.season, r.due)}) </span>)}</>}
            {st.requests.length > 0 && <> · Requested for next month: {st.requests.map((id) => <span key={id}><a href={href('player', [id])}>{league.players[id]?.last}</a> </span>)}</>}
          </p>
        )}
      </div>
      <div className="row-gap" style={{ margin: '10px 0' }}>
        {(['all', 'pro', 'ours', 'draft', 'intl', 'mine'] as const).map((f) => (
          <button key={f} className={`btn btn-sm${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
            {f === 'all' ? `All (${reports.length})` : f === 'pro' ? 'Other clubs' : f === 'ours' ? 'Our system' : f === 'draft' ? 'Draft class' : f === 'intl' ? 'International' : 'Requested / rushed'}
          </button>
        ))}
      </div>
      {rows.length ? <DataTable rows={rows} cols={cols} rowKey={(p) => p.id} defaultSort={{ key: 'day', desc: true }} compact maxHeight={700} /> : <p className="muted">No reports yet: your scouts file them through the month.</p>}
    </>
  );
}
