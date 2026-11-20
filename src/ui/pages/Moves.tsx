import { useStore } from '../../store.ts';
import { go, href, useRoute } from '../../router.ts';
import type { League, Move, MoveType } from '../../core/types.ts';
import { MOVE_TYPES } from '../../core/types.ts';
import { playerWar, salaryPaid } from '../../core/war.ts';
import { fmtMoney } from '../../core/contracts.ts';
import { dayShort } from '../../core/settings.ts';
import { posLabel } from '../../core/rules.ts';
import { DataTable, type Column } from '../components.tsx';

export function sideWar(league: League, m: Move, i: number): { war: number; paid: number } {
  const s = m.sides[i];
  let war = 0;
  let paid = 0;
  for (const id of s.gets) {
    const p = league.players[id];
    if (!p) continue;
    war += playerWar(league, p, { orgId: s.orgId, from: m.start });
    paid += salaryPaid(p, s.orgId, m.start);
  }
  return { war, paid };
}

interface Row {
  m: Move;
  me: number; // side index from the viewing team's perspective
  warIn: number;
  warOut: number;
  paid: number;
}

const fmtWar = (x: number) => (Math.abs(x) < 0.05 ? '0.0' : x.toFixed(1));
const cls = (x: number) => (x > 0.05 ? 'pos' : x < -0.05 ? 'neg' : '');

export default function Moves() {
  const { league } = useStore();
  const route = useRoute();
  if (!league) return null;
  const team = route.query.team === 'all' ? null : Number(route.query.team ?? league.userOrgId);
  const type = (route.query.type ?? '') as MoveType | '';
  const season = route.query.season ? Number(route.query.season) : null;
  const onlyWar = route.query.war === '1';
  const set = (k: string, v: string | number | undefined) => go('moves', [], { team: route.query.team, type: route.query.type, season: route.query.season, war: route.query.war, [k]: v });
  const moves = league.moves ?? [];
  const seasons = [...new Set(moves.map((m) => m.season))].sort((a, b) => b - a);

  const rows: Row[] = [];
  for (const m of moves) {
    if (type && m.type !== type) continue;
    if (season !== null && m.season !== season) continue;
    const me = team === null ? 0 : m.sides.findIndex((s) => s.orgId === team);
    if (me < 0) continue;
    const mine = sideWar(league, m, me);
    let warOut = 0;
    for (let i = 0; i < m.sides.length; i++) if (i !== me) warOut += sideWar(league, m, i).war;
    if (onlyWar && Math.abs(mine.war) < 0.05 && Math.abs(warOut) < 0.05) continue;
    rows.push({ m, me, warIn: mine.war, warOut, paid: mine.paid });
  }

  // Summary by type for the selected team.
  const summary = team === null ? [] : MOVE_TYPES.map((t) => {
    const rs = rows.filter((r) => r.m.type === t);
    return { t, n: rs.length, warIn: rs.reduce((s, r) => s + r.warIn, 0), warOut: rs.reduce((s, r) => s + r.warOut, 0), paid: rs.reduce((s, r) => s + r.paid, 0), cost: rs.reduce((s, r) => s + (r.m.sides[r.me].gets.length ? r.m.cost : 0), 0) };
  }).filter((x) => x.n > 0);

  const cols: Column<Row>[] = [
    { key: 'date', label: 'Date', value: (r) => r.m.season * 1000 + r.m.day, render: (r) => <a href={href('move', [r.m.id])}>{dayShort(r.m.season, r.m.day)}</a>, sortDesc: true },
    { key: 'type', label: 'Type', left: true, value: (r) => r.m.type },
    { key: 'text', label: 'Move', left: true, value: (r) => r.m.text, render: (r) => <a href={href('move', [r.m.id])}>{r.m.text}</a> },
    ...(team === null ? [] : [{ key: 'side', label: 'Side', left: true, value: (r: Row) => (r.m.sides[r.me].gets.length ? 'Acquired' : 'Lost') } as Column<Row>]),
    { key: 'in', label: team === null ? 'WAR (first team)' : 'WAR acquired', value: (r) => r.warIn, render: (r) => fmtWar(r.warIn), sortDesc: true },
    { key: 'out', label: team === null ? 'WAR (other side)' : 'WAR given up', value: (r) => r.warOut, render: (r) => (r.m.sides.length > 1 ? fmtWar(r.warOut) : ''), sortDesc: true },
    { key: 'net', label: 'Net', value: (r) => r.warIn - r.warOut, render: (r) => <span className={cls(r.warIn - r.warOut)}>{fmtWar(r.warIn - r.warOut)}</span>, sortDesc: true },
    { key: 'paid', label: 'Salary paid', value: (r) => r.paid, render: (r) => (r.paid ? fmtMoney(r.paid) : ''), sortDesc: true },
    { key: 'cost', label: 'Guarantee / bonus', value: (r) => r.m.cost, render: (r) => (r.m.cost && r.m.sides[r.me].gets.length ? fmtMoney(r.m.cost) : ''), sortDesc: true },
  ];

  return (
    <>
      <h1>Transaction Review</h1>
      <p className="muted small">Every acquisition since this league started tracking moves, judged by what happened next: MLB WAR each club got from the players it acquired (while they were with that club), and what it gave up. Click a move for the season-by-season breakdown.</p>
      <div className="form-row">
        <select value={team === null ? 'all' : team} onChange={(e) => set('team', e.target.value)}>
          <option value="all">All teams</option>
          {league.orgs.map((o) => <option key={o.id} value={o.id}>{o.region} {o.name}</option>)}
        </select>{' '}
        <select value={type} onChange={(e) => set('type', e.target.value || undefined)}>
          <option value="">All moves</option>
          {MOVE_TYPES.map((t) => <option key={t} value={t}>{t === 'Free agent' ? 'Free agent signings' : t === 'Draft' ? 'Draft signings' : t === 'International' ? 'International signings' : t === 'Trade' ? 'Trades' : t === 'Waiver claim' ? 'Waiver claims' : t}</option>)}
        </select>{' '}
        <select value={season ?? ''} onChange={(e) => set('season', e.target.value || undefined)}>
          <option value="">All seasons</option>
          {seasons.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>{' '}
        <label><input type="checkbox" checked={onlyWar} onChange={(e) => set('war', e.target.checked ? '1' : undefined)} /> Only moves with MLB WAR</label>
      </div>
      {summary.length > 0 && (
        <table className="data compact" style={{ maxWidth: 700 }}>
          <thead><tr><th className="l">{league.orgs[team!].abbrev} by type</th><th>Moves</th><th>WAR acquired</th><th>WAR given up</th><th>Net</th><th>Salary paid</th><th>$ per WAR</th></tr></thead>
          <tbody>
            {summary.map((x) => (
              <tr key={x.t}>
                <td className="l">{x.t}</td><td>{x.n}</td><td>{fmtWar(x.warIn)}</td><td>{x.t === 'Trade' || x.warOut ? fmtWar(x.warOut) : ''}</td>
                <td className={cls(x.warIn - x.warOut)}>{fmtWar(x.warIn - x.warOut)}</td>
                <td>{x.paid ? fmtMoney(x.paid) : ''}</td>
                <td>{x.warIn > 0.5 && x.paid ? fmtMoney(x.paid / x.warIn) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rows.length === 0 ? <p className="muted">No moves match.</p> : <DataTable cols={cols} rows={rows} rowKey={(r) => `${r.m.id}-${r.me}`} defaultSort={{ key: 'date', desc: true }} compact />}
    </>
  );
}

export function MoveDetail() {
  const { league } = useStore();
  const route = useRoute();
  if (!league) return null;
  const m = (league.moves ?? []).find((x) => x.id === Number(route.args[0]));
  if (!m) return <p>Move not found.</p>;
  const lastSeason = league.phase === 'offseason' ? league.season : league.season;
  const years: number[] = [];
  for (let y = m.start; y <= lastSeason; y++) years.push(y);
  const totals = m.sides.map((_, i) => sideWar(league, m, i));
  const best = m.sides.length > 1 ? totals.map((t, i) => ({ i, net: t.war - totals.reduce((s, x, j) => (j === i ? s : s + x.war), 0) })).sort((a, b) => b.net - a.net)[0] : null;

  return (
    <>
      <h1>{m.type}: {dayShort(m.season, m.day)}</h1>
      <p>{m.text}{m.cost ? ` (${m.type === 'Draft' || m.type === 'International' ? 'bonus' : 'guaranteed'} ${fmtMoney(m.cost)})` : ''}</p>
      {best && Math.abs(best.net) >= 0.5 && <p><b>{league.orgs[m.sides[best.i].orgId].region} {league.orgs[m.sides[best.i].orgId].name}</b> lead this {m.type === 'Trade' ? 'trade' : 'move'} by {best.net.toFixed(1)} WAR so far.</p>}
      {m.sides.map((s, i) => {
        const org = league.orgs[s.orgId];
        return (
          <div key={i}>
            <h2>{org.region} {org.name} {s.gets.length ? 'received' : 'lost the player'}</h2>
            {s.gets.length > 0 ? (
              <table className="data compact">
                <thead>
                  <tr>
                    <th className="l">Player</th><th>Pos</th><th className="l">Now</th>
                    {years.map((y) => <th key={y}>{y}</th>)}
                    <th>WAR</th><th>Salary paid</th>
                  </tr>
                </thead>
                <tbody>
                  {s.gets.map((id) => {
                    const p = league.players[id];
                    if (!p) return <tr key={id}><td className="l muted">(deleted)</td></tr>;
                    const now = p.retired ? `Retired ${p.retired}` : p.orgId === null ? 'Free agent' : p.orgId === s.orgId ? `${p.level}` : league.orgs[p.orgId].abbrev;
                    return (
                      <tr key={id}>
                        <td className="l"><a href={href('player', [id])}>{p.first} {p.last}</a></td>
                        <td>{posLabel(p)}</td>
                        <td className="l">{now}</td>
                        {years.map((y) => {
                          const w = playerWar(league, p, { orgId: s.orgId, season: y });
                          return <td key={y}>{w ? fmtWar(w) : <span className="muted">-</span>}</td>;
                        })}
                        <td><b>{fmtWar(playerWar(league, p, { orgId: s.orgId, from: m.start }))}</b></td>
                        <td>{fmtMoney(salaryPaid(p, s.orgId, m.start))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="muted">Nothing in return.</p>
            )}
            {(s.cash > 0 || s.pool > 0 || s.picks.length > 0) && (
              <p className="small">Also received: {[s.cash ? `${fmtMoney(s.cash)} cash` : '', s.pool ? `${fmtMoney(s.pool)} international pool money` : '', ...s.picks].filter(Boolean).join(', ')}</p>
            )}
            <p className="small">Total: <b>{fmtWar(totals[i].war)} WAR</b>, {fmtMoney(totals[i].paid)} paid.</p>
          </div>
        );
      })}
      <p className="muted small">WAR counts MLB production with the acquiring club only, from {m.start} on. <a href={href('moves')}>All moves</a></p>
    </>
  );
}
