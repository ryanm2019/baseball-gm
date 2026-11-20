import { useStore } from '../../store.ts';
import { href } from '../../router.ts';
import { LEVELS } from '../../core/types.ts';
import type { League, Org } from '../../core/types.ts';
import { userRosterIssues } from '../../core/sim/day.ts';
import { dayShort, LEVEL_NAMES } from '../../core/settings.ts';
import { cbtTax, fmtMoney, orgPayroll } from '../../core/contracts.ts';
import { activeAt, fortyMan, orgById, pname } from '../../core/util.ts';
import { era, fmt3, obp, ops, seasonBat, seasonPit, slg, avg } from '../fmt.tsx';
import { isPitcher } from '../../core/ratings.ts';
import { farmDirectorOf } from '../../core/farmDirector.ts';
import { nextEvent } from '../../core/offseason.ts';

export function divStandings(league: League, org: Org) {
  const st = league.standings.MLB;
  const rows = league.orgs.filter((o) => o.league === org.league && o.div === org.div).sort((a, b) => st[b.id].w - st[b.id].l - (st[a.id].w - st[a.id].l));
  const lead = st[rows[0].id];
  return rows.map((o) => {
    const r = st[o.id];
    const gb = (lead.w - r.w + (r.l - lead.l)) / 2;
    return { o, r, gb };
  });
}

export default function Dashboard() {
  const { league } = useStore();
  if (!league) return null;
  const org = league.orgs[league.userOrgId];
  const issues = league.phase === 'regular' ? userRosterIssues(league) : [];
  const st = league.standings.MLB[org.id];
  const div = divStandings(league, org);
  const myGames = league.schedule.filter((g) => g.level === 'MLB' && (g.home === org.id || g.away === org.id));
  const upcoming = myGames.filter((g) => !g.result).slice(0, 5);
  const recent = myGames.filter((g) => g.result).slice(-5).reverse();
  const pay = orgPayroll(league, org);
  const tax = cbtTax(pay.cbt, org.cbtPayerYears, league.settings);
  const mlb = activeAt(league, org.id, 'MLB');
  const hitters = mlb.filter((p) => !isPitcher(p)).map((p) => ({ p, b: seasonBat(p, league.season, 'MLB') })).filter((x) => x.b.pa > 0);
  const pitchers = mlb.filter(isPitcher).map((p) => ({ p, s: seasonPit(p, league.season, 'MLB') })).filter((x) => x.s.outs > 0);
  const news = league.news.filter((n) => n.orgId === org.id || n.orgId === null).slice(-10).reverse();
  const fd = farmDirectorOf(league, org);

  const opp = (g: (typeof myGames)[0]) => {
    const home = g.home === org.id;
    const o = orgById(league, home ? g.away : g.home)!;
    return `${home ? 'vs' : '@'} ${o.abbrev}`;
  };

  return (
    <>
      <h1>{org.region} {org.name} Dashboard</h1>
      {league.phase === 'offseason' && (() => {
        const ev = nextEvent(league);
        return (
          <div className="alert alert-info">
            Offseason. {ev ? <>Next: <b>{ev.label}</b> on {dayShort(league.season, ev.day)}. </> : null}
            <a href={href('offseason')}>Offseason calendar</a> · <a href={href('free-agents')}>Free agents</a>
          </div>
        );
      })()}
      {league.phase === 'preseason' && (
        <div className="alert alert-info">
          Spring training. Get the MLB roster to {league.settings.activeMax} by Opening Day ({activeAt(league, org.id, 'MLB').length} now). <a href={href('roster')}>Roster</a>
        </div>
      )}
      {issues.map((i) => (
        <div key={i} className="alert alert-warn">
          {i} <a href={href('roster')}>Go to roster</a>
        </div>
      ))}
      <div className="cards">
        <div className="box">
          <h2 style={{ marginTop: 0 }}>
            {st.w}-{st.l}
          </h2>
          <div className="kv">
            <div>Division</div>
            <div>{org.league} {org.div}, {div.findIndex((d) => d.o.id === org.id) + 1}{['st', 'nd', 'rd', 'th', 'th'][div.findIndex((d) => d.o.id === org.id)]}</div>
            <div>Run differential</div>
            <div className={st.rs - st.ra >= 0 ? 'pos' : 'neg'}>{st.rs - st.ra > 0 ? '+' : ''}{st.rs - st.ra}</div>
            <div>Streak</div>
            <div>{st.streak > 0 ? `W${st.streak}` : st.streak < 0 ? `L${-st.streak}` : '-'}</div>
            <div>Active / 40-man</div>
            <div>{mlb.length} / {fortyMan(league, org.id).length}</div>
            <div>CBT payroll</div>
            <div>{fmtMoney(pay.cbt)}{tax.tax > 0 ? ` (tax ${fmtMoney(tax.tax)})` : ''}</div>
            <div>Farm director</div>
            <div>{fd ? `${fd.first} ${fd.last} (${fd.philosophy})` : <a href={href('staff')}>None, hire one</a>}</div>
          </div>
          <h3>{org.league} {org.div}</h3>
          <table className="data compact">
            <thead>
              <tr><th className="l">Team</th><th>W</th><th>L</th><th>GB</th></tr>
            </thead>
            <tbody>
              {div.map(({ o, r, gb }) => (
                <tr key={o.id} className={o.id === org.id ? 'user' : ''}>
                  <td className="l"><a href={href('roster', [], { org: o.id })}>{o.region} {o.name}</a></td>
                  <td>{r.w}</td><td>{r.l}</td><td>{gb === 0 ? '-' : gb.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="box">
          <h3 style={{ marginTop: 0 }}>Recent games</h3>
          {recent.length === 0 && <p className="muted">None yet.</p>}
          {recent.map((g) => {
            const home = g.home === org.id;
            const us = home ? g.result!.hs : g.result!.as;
            const them = home ? g.result!.as : g.result!.hs;
            return (
              <div key={g.id}>
                <span className={us > them ? 'pos' : 'neg'}>{us > them ? 'W' : 'L'}</span> {us}-{them} {opp(g)}{' '}
                <a href={href('box', [g.id])} className="small">box</a>
              </div>
            );
          })}
          <h3>Upcoming</h3>
          {upcoming.map((g) => (
            <div key={g.id}>
              {dayShort(league.season, g.day)} {opp(g)}
            </div>
          ))}
          <h3>Affiliates</h3>
          <table className="data compact">
            <tbody>
              {LEVELS.map((l) => {
                const r = league.standings[l][org.id];
                return (
                  <tr key={l}>
                    <td className="l">{l}</td>
                    <td className="l"><a href={href('roster', [], { level: l })}>{org.affiliates[l].name}</a></td>
                    <td>{r.w}-{r.l}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted small">{LEVEL_NAMES.CPX} and DSL seasons start in June.</p>
        </div>

        <div className="box">
          <h3 style={{ marginTop: 0 }}>Team leaders</h3>
          {hitters.length > 0 && (
            <div className="kv">
              {(() => {
                const q = hitters.filter((x) => x.b.pa >= Math.max(10, (st.w + st.l) * 2.5));
                const pool = q.length ? q : hitters;
                const bestOps = [...pool].sort((a, b) => ops(b.b) - ops(a.b))[0];
                const bestHr = [...hitters].sort((a, b) => b.b.hr - a.b.hr)[0];
                return (
                  <>
                    <div>OPS</div>
                    <div><a href={href('player', [bestOps.p.id])}>{pname(bestOps.p)}</a> {fmt3(avg(bestOps.b))}/{fmt3(obp(bestOps.b))}/{fmt3(slg(bestOps.b))}</div>
                    <div>HR</div>
                    <div><a href={href('player', [bestHr.p.id])}>{pname(bestHr.p)}</a> {bestHr.b.hr}</div>
                  </>
                );
              })()}
            </div>
          )}
          {pitchers.length > 0 && (
            <div className="kv">
              {(() => {
                const sp = pitchers.filter((x) => x.s.gs > 0).sort((a, b) => (a.s.outs > 30 ? era(a.s) : 99) - (b.s.outs > 30 ? era(b.s) : 99))[0];
                const k = [...pitchers].sort((a, b) => b.s.k - a.s.k)[0];
                const sv = [...pitchers].sort((a, b) => b.s.sv - a.s.sv)[0];
                return (
                  <>
                    {sp && (<><div>ERA</div><div><a href={href('player', [sp.p.id])}>{pname(sp.p)}</a> {era(sp.s).toFixed(2)}</div></>)}
                    <div>K</div>
                    <div><a href={href('player', [k.p.id])}>{pname(k.p)}</a> {k.s.k}</div>
                    <div>SV</div>
                    <div><a href={href('player', [sv.p.id])}>{pname(sv.p)}</a> {sv.s.sv}</div>
                  </>
                );
              })()}
            </div>
          )}
          {hitters.length === 0 && <p className="muted">Season hasn't started.</p>}
          <h3>News</h3>
          {news.length === 0 && <p className="muted">Nothing yet.</p>}
          <div style={{ maxWidth: 420 }}>
            {news.map((n) => (
              <div key={n.id} className="news-item small">
                <span className="muted">{dayShort(n.season, n.day)}</span> {n.text}
              </div>
            ))}
          </div>
          <a href={href('news')} className="small">All news</a>
        </div>
      </div>
    </>
  );
}
