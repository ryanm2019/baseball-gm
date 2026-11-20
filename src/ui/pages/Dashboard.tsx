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
import { useState } from 'react';
import { changed } from '../../store.ts';
import { OrgSelect } from '../components.tsx';
import { expectedWins, setOwnerGoals } from '../../core/owners.ts';

function Goals({ league, org }: { league: League; org: Org }) {
  const g = org.goals;
  if (!g) return null;
  const st = league.standings.MLB[org.id];
  const games = st.w + st.l;
  const thisSeason = g.season === league.season && league.phase !== 'offseason' && league.phase !== 'preseason';
  const pay = orgPayroll(league, org).cbt;
  const status = (type: string, target: number): { text: string; ok: boolean | null } => {
    if (g.season !== league.season) return { text: 'Next season', ok: null };
    const done = league.phase === 'offseason';
    const met = g.items.find((x) => x.type === type)?.met;
    if (done && met !== undefined && met !== null) return { text: met ? 'Met' : 'Missed', ok: met };
    switch (type) {
      case 'wins': {
        if (!thisSeason || games < 10) return { text: `${st.w} wins`, ok: null };
        const pace = Math.round((st.w / games) * 162);
        return { text: `${pace}-win pace`, ok: pace >= target };
      }
      case 'playoffs': {
        if (!thisSeason) return { text: '-', ok: null };
        const same = league.orgs.filter((o) => o.league === org.league).map((o) => league.standings.MLB[o.id]).map((x) => x.w - x.l).sort((a, b) => b - a);
        const gb = ((same[5] ?? 0) - (st.w - st.l)) / 2;
        return { text: gb > 0 ? `${gb.toFixed(1)} GB of last spot` : 'In position', ok: gb <= 0 };
      }
      case 'series':
        return { text: league.phase === 'playoffs' ? 'Playoffs underway' : '-', ok: null };
      default:
        return { text: `Now ${fmtMoney(pay)}`, ok: pay <= target };
    }
  };
  return (
    <>
      <h3>Owner's goals for {g.season}</h3>
      <table className="data compact">
        <tbody>
          {g.items.map((x) => {
            const s = status(x.type, x.target);
            return (
              <tr key={x.type}>
                <td className="l">{x.text}</td>
                <td className={s.ok === null ? 'muted' : s.ok ? 'pos' : 'neg'}>{s.text}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">Roster projects to about {Math.round(expectedWins(league, org.id))} wins.{league.settings.allowFiring ? '' : ' Firing is off (League Settings).'}</p>
    </>
  );
}

function Fired({ league }: { league: League }) {
  const [pick, setPick] = useState(league.orgs.find((o) => o.id !== league.userOrgId)!.id);
  return (
    <div className="alert alert-err">
      <b>You've been fired.</b> Another club is willing to hire you:{' '}
      <OrgSelect league={league} value={pick} onChange={setPick} />{' '}
      <button
        className="btn btn-sm"
        onClick={() => {
          league.userOrgId = pick;
          league.orgs[pick].owner.patience = 50;
          league.fired = false;
          setOwnerGoals(league);
          changed();
        }}
      >
        Take the job
      </button>
    </div>
  );
}

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
      {league.fired && <Fired league={league} />}
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
      {league.tradeOffers.length > 0 && (
        <div className="alert alert-info">
          {league.tradeOffers.length === 1 ? `The ${league.orgs[league.tradeOffers[0].fromOrg].affiliates.MLB.name} reached out with a trade offer.` : `${league.tradeOffers.length} clubs have reached out with trade offers.`}{' '}
          <a href={href('trade-offers')}>Trade Offers</a>
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
            <div>Owner</div>
            <div>{org.owner.first} {org.owner.last} ({org.owner.type.toLowerCase()})</div>
            <div>Budget</div>
            <div>{fmtMoney(org.budget)}</div>
            <div>Job security</div>
            <div>
              <span className={org.owner.patience < 25 ? 'neg' : org.owner.patience >= 60 ? 'pos' : ''}>{org.owner.patience}/100</span>
            </div>
            <div>Farm director</div>
            <div>{fd ? `${fd.first} ${fd.last} (${fd.philosophy})` : <a href={href('staff')}>None, hire one</a>}</div>
          </div>
          <Goals league={league} org={org} />
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
