import { useStore } from '../../store.ts';
import { finOf, revenueSoFar } from '../../core/finances.ts';
import { href } from '../../router.ts';
import { LEVELS } from '../../core/types.ts';
import type { League, Org } from '../../core/types.ts';
import { userRosterIssues, userRosterWarnings } from '../../core/sim/day.ts';
import { dayShort, LEVEL_NAMES } from '../../core/settings.ts';
import { cbtTax, fmtMoney, orgPayroll } from '../../core/contracts.ts';
import { activeAt, fortyMan, orgById, orgPlayers, pname } from '../../core/util.ts';
import { era, fmt3, obp, ops, seasonBat, seasonPit, slg, avg } from '../fmt.tsx';
import { isPitcher } from '../../core/ratings.ts';
import { farmDirectorOf } from '../../core/farmDirector.ts';
import { nextEvent } from '../../core/offseason.ts';
import { useState } from 'react';
import { changed } from '../../store.ts';
import { LinkedText, OrgSelect } from '../components.tsx';
import { expectedWins, setOwnerGoals } from '../../core/owners.ts';
import { deptSpend } from '../../core/depts.ts';
import { TeamBadge } from '../show.tsx';
import { heat } from '../../core/form.ts';

const ordinal = (n: number) => `${n}${['st', 'nd', 'rd'][n - 1] ?? 'th'}`;

// Who's hot and who's cold on the big league club.
function HotCold({ league, org }: { league: League; org: Org }) {
  const list = orgPlayers(league, org.id).filter((p) => p.level === 'MLB').map((p) => ({ p, h: heat(league, p) })).filter((x) => x.h);
  const hot = list.filter((x) => x.h!.kind === 'hot');
  const cold = list.filter((x) => x.h!.kind === 'cold');
  return (
    <>
      <h3 style={{ marginTop: 0 }}>Who's hot, who's not</h3>
      {league.phase !== 'regular' && league.phase !== 'playoffs' ? <p className="muted small">Streaks start once the season does.</p> : !list.length ? <p className="muted small">Nobody on a real streak right now.</p> : (
        <div className="hotcold">
          {[['🔥 Hot', hot], ['❄️ Cold', cold]].map(([label, xs]) => (
            <div key={label as string}>
              <h4>{label as string}</h4>
              {(xs as typeof list).length ? (xs as typeof list).map(({ p, h }) => (
                <div key={p.id} className="row" title={h!.text}>
                  <a href={href('player', [p.id])}>{p.first[0]}. {p.last}</a>
                  <span className="muted">{h!.short}</span>
                </div>
              )) : <div className="muted small">None</div>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

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
  const warnings = league.phase === 'regular' || league.phase === 'playoffs' ? userRosterWarnings(league) : [];
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
      <div className="show show-banner">
        <div className="dash-banner">
          <div className="dash-team">
            <TeamBadge league={league} orgId={org.id} size={64} />
            <div>
              <div className="nm">{org.region} {org.name}</div>
              <div className="sub">{org.league} {org.div} · {ordinal(div.findIndex((d) => d.o.id === org.id) + 1)}{(() => { const gb = div.find((d) => d.o.id === org.id)?.gb ?? 0; return gb > 0 ? ` · ${gb.toFixed(1)} GB` : st.w + st.l > 0 ? ' · leads the division' : ''; })()}</div>
            </div>
          </div>
          <div className="dash-rec">{st.w}-{st.l}<small>{league.phase === 'preseason' ? `${league.season} spring training` : `${league.season} record`}</small></div>
          <div>
            <div className="small muted" style={{ textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700, fontSize: 11 }}>Last 10 · {st.streak > 0 ? `W${st.streak}` : st.streak < 0 ? `L${-st.streak}` : 'no streak'}</div>
            <div className="l10">{st.last10 ? st.last10.split('').map((c, i) => <span key={i} className={c}>{c}</span>) : <span className="muted small" style={{ width: 'auto' }}>No games yet</span>}</div>
          </div>
        </div>
        <div className="kpis">
          <div className="kpi"><span>Run differential</span><b className={st.rs - st.ra > 0 ? 'pos' : st.rs - st.ra < 0 ? 'neg' : ''}>{st.rs - st.ra > 0 ? '+' : ''}{st.rs - st.ra}</b><i>{st.rs} scored · {st.ra} allowed</i></div>
          <div className="kpi"><span>Projected wins</span><b>{Math.round(expectedWins(league, org.id))}</b><i>{st.w + st.l >= 10 ? `${Math.round((st.w / (st.w + st.l)) * 162)}-win pace` : 'from the roster'}</i></div>
          <div className="kpi"><span>CBT payroll</span><b className={pay.cbt > org.budget ? 'neg' : ''}>{fmtMoney(pay.cbt)}</b><i>budget {fmtMoney(org.budget)}{tax.tax > 0 ? ` · tax ${fmtMoney(tax.tax)}` : ''}</i></div>
          <div className="kpi"><span>Active / 40-man</span><b>{mlb.length} / {fortyMan(league, org.id).length}</b><i>max {league.settings.activeMax} / {league.settings.fortyMax}</i></div>
          <div className="kpi"><span>Revenue</span><b>{fmtMoney(revenueSoFar(league, org).total)}</b><i>hype {Math.round(finOf(league, org).hype)}</i></div>
          <div className="kpi"><span>Job security</span><b className={org.owner.patience < 25 ? 'neg' : org.owner.patience >= 60 ? 'pos' : ''}>{org.owner.patience}/100</b><i>{org.owner.first} {org.owner.last}</i></div>
        </div>
      </div>
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
          Spring training. Get the MLB roster to {league.settings.activeMax} by Opening Day ({activeAt(league, org.id, 'MLB').length} now). <a href={href('roster')}>Roster</a> · <a href={href('preview')}><b>{league.season} Season Preview</b></a>
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
      {warnings.map((i) => (
        <div key={i} className="alert alert-info small">
          {i} <a href={href('roster-moves')}>Roster Moves</a>
        </div>
      ))}
      <div className="cards">
        <div className="box">
          <div className="kv">
            <div>Owner</div>
            <div>{org.owner.first} {org.owner.last} ({org.owner.type.toLowerCase()})</div>
            <div>Departments</div>
            <div className={deptSpend(org) > org.opBudget ? 'neg' : ''}><a href={href('departments')}>{fmtMoney(deptSpend(org))}</a> of {fmtMoney(org.opBudget)}</div>
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
          <HotCold league={league} org={org} />
          <h3>Team leaders</h3>
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
          {(() => {
            const need = (league.inbox ?? []).filter((m) => m.actions && !m.resolved).length;
            const unread = (league.inbox ?? []).filter((m) => !m.read).length;
            return unread > 0 ? <div className="alert alert-info small"><a href={href('inbox')}>Inbox: {unread} unread{need ? `, ${need} waiting for your decision` : ''}</a></div> : null;
          })()}
          <h3>Insider</h3>
          {!(league.scoops ?? []).length && <p className="muted small">Free agent meetings, finalists, agreements, trades and players being shopped show up here.</p>}
          <div style={{ maxWidth: 420 }}>
            {(league.scoops ?? []).slice(-8).reverse().map((n) => (
              <div key={n.id} className="news-item small">
                <span className="muted">{dayShort(n.season, n.day)}</span> <LinkedText league={league} text={n.text} pids={n.pids} />
              </div>
            ))}
          </div>
          <h3>News</h3>
          {news.length === 0 && <p className="muted">Nothing yet.</p>}
          <div style={{ maxWidth: 420 }}>
            {news.map((n) => (
              <div key={n.id} className="news-item small">
                <span className="muted">{dayShort(n.season, n.day)}</span> <LinkedText league={league} text={n.text} pids={n.pids} />
              </div>
            ))}
          </div>
          <a href={href('news')} className="small">All news</a>
        </div>
      </div>
    </>
  );
}
