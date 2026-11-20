// Attendance, revenue, fan hype and ticket prices; how revenue moves next
// year's budget.
import { useStore, changed } from '../../store.ts';
import { fmtMoney } from '../../core/contracts.ts';
import { baseTicket, capacity, crowd, expectedRevenue, finOf, revenueFactor, revenueSoFar } from '../../core/finances.ts';
import { DataTable, type Column } from '../components.tsx';
import type { Org } from '../../core/types.ts';

export default function Finances() {
  const { league } = useStore();
  if (!league) return null;
  const org = league.orgs[league.userOrgId];
  const f = finOf(league, org);
  const rev = revenueSoFar(league, org);
  const base = baseTicket(org);
  const rf = revenueFactor(org);
  const cols: Column<Org>[] = [
    { key: 'team', label: 'Team', left: true, value: (o) => `${o.region} ${o.name}` },
    { key: 'hype', label: 'Hype', value: (o) => Math.round(finOf(league, o).hype) },
    { key: 'att', label: 'Avg attendance', value: (o) => { const x = finOf(league, o); return x.games ? Math.round(x.attendance / x.games) : 0; } },
    { key: 'ticket', label: 'Ticket', value: (o) => finOf(league, o).ticket, render: (o) => `$${finOf(league, o).ticket}` },
    { key: 'rev', label: 'Revenue so far', value: (o) => revenueSoFar(league, o).total, render: (o) => fmtMoney(revenueSoFar(league, o).total) },
    { key: 'last', label: 'Last season', value: (o) => finOf(league, o).last?.revenue ?? 0, render: (o) => (finOf(league, o).last ? fmtMoney(finOf(league, o).last!.revenue) : '-') },
    { key: 'budget', label: 'Budget', value: (o) => o.budget, render: (o) => fmtMoney(o.budget) },
  ];
  return (
    <>
      <h1>Finances</h1>
      <div className="cards">
        <div className="box">
          <h3>This season</h3>
          <div className="kv">
            <div>Fan hype</div><div><b>{Math.round(f.hype)}</b>/100 <span className="muted small">(winning, the playoffs and stars build it; high prices wear it down)</span></div>
            <div>Home games</div><div>{f.games}</div>
            <div>Average attendance</div><div>{f.games ? Math.round(f.attendance / f.games).toLocaleString() : '-'} of {capacity(org).toLocaleString()}</div>
            <div>Gate</div><div>{fmtMoney(rev.gate)}</div>
            <div>Merchandise</div><div>{fmtMoney(rev.merch)}</div>
            <div>Local media</div><div>{fmtMoney(rev.media)}</div>
            <div>National revenue</div><div>{fmtMoney(rev.national)}</div>
            <div>Playoff gates</div><div>{fmtMoney(rev.playoffs)}</div>
            <div><b>Total</b></div><div><b>{fmtMoney(rev.total)}</b> <span className="muted small">(a typical season in your market: {fmtMoney(expectedRevenue(org, league))})</span></div>
          </div>
        </div>
        <div className="box">
          <h3>Ticket price</h3>
          <p className="small">Average ticket: <b>${f.ticket}</b> (market default ${base}). Projected crowd at this price: <b>{crowd(league, org, f.ticket).toLocaleString()}</b>.</p>
          <input type="range" min={Math.round(base * 0.6)} max={Math.round(base * 1.6)} value={f.ticket} onChange={(e) => { f.ticket = Number(e.target.value); changed(); }} style={{ width: 260 }} />
          <p className="muted small">Higher prices bring in more per fan but fewer fans, and slowly cost you hype.</p>
          <h3>Next year's budget</h3>
          <p className="small">
            {rf === null
              ? 'Your owner will set next year\'s budget from your revenue once a season of books is closed.'
              : `Last season you brought in ${fmtMoney(finOf(league, org).last!.revenue)} against ${fmtMoney(finOf(league, org).last!.expected)} expected for your market, so your owner's budget moves ×${rf.toFixed(2)}.`}{' '}
            Current budget: <b>{fmtMoney(org.budget)}</b>.
          </p>
        </div>
      </div>
      <h2>League</h2>
      <DataTable cols={cols} rows={league.orgs} rowKey={(o) => o.id} defaultSort={{ key: 'rev', desc: true }} compact />
    </>
  );
}
