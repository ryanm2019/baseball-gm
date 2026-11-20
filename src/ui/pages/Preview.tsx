// Season preview (like Basketball GM's): projected standings, rising and
// falling teams and players, top players and prospects, the last draft's first
// round, and the winter's biggest moves.
import type React from 'react';
import { useStore } from '../../store.ts';
import { href } from '../../router.ts';
import type { League, Player } from '../../core/types.ts';
import { displayOvr, grade, scoutedOvr, scoutedPot } from '../../core/ratings.ts';
import { expectedWins } from '../../core/owners.ts';
import { posLabel } from '../../core/rules.ts';
import { fmtMoney } from '../../core/contracts.ts';
import { Rating } from '../components.tsx';

function PlayerRow({ league, p, extra }: { league: League; p: Player; extra?: React.ReactNode }) {
  const org = p.orgId !== null ? league.orgs[p.orgId] : null;
  return (
    <tr>
      <td className="l"><a href={href('player', [p.id])}>{p.first} {p.last}</a></td>
      <td>{posLabel(p)}</td>
      <td>{league.season - p.born}</td>
      <td>{org ? <a href={href('roster', [], { org: org.id })}>{org.abbrev}</a> : 'FA'}</td>
      <td>{p.level ?? '-'}</td>
      {extra ?? (
        <>
          <td><Rating v={scoutedOvr(league, p)} /></td>
          <td><Rating v={scoutedPot(league, p)} /></td>
        </>
      )}
    </tr>
  );
}

export default function Preview() {
  const { league } = useStore();
  if (!league) return null;
  const pv = league.preview;
  const season = league.phase === 'offseason' ? league.season + 1 : league.season;
  const players = Object.values(league.players).filter((p) => !p.retired && p.orgId !== null);
  const mlb = players.filter((p) => p.level === 'MLB');
  const topPlayers = [...mlb].sort((a, b) => scoutedOvr(league, b) - scoutedOvr(league, a)).slice(0, 15);
  const topProspects = players.filter((p) => p.level !== 'MLB' && !p.prospect && !p.ifa).sort((a, b) => scoutedPot(league, b) - scoutedPot(league, a) || scoutedOvr(league, b) - scoutedOvr(league, a)).slice(0, 15);
  const proj = league.orgs.map((o) => ({ o, w: Math.round(expectedWins(league, o.id)), last: league.lastWins?.[o.id] }));
  const withLast = proj.filter((x) => x.last !== undefined);
  const rising = [...withLast].sort((a, b) => b.w - b.last! - (a.w - a.last!)).slice(0, 5);
  const falling = [...withLast].sort((a, b) => a.w - a.last! - (b.w - b.last!)).slice(0, 5);
  const fa = (league.moves ?? []).filter((m) => m.type === 'Free agent' && m.start === season).sort((a, b) => b.cost - a.cost).slice(0, 10);
  const trades = (league.moves ?? [])
    .filter((m) => m.type === 'Trade' && m.start === season)
    .map((m) => ({ m, size: m.sides.reduce((t, s) => t + s.gets.reduce((u, id) => u + (league.players[id] ? Math.max(0, scoutedOvr(league, league.players[id]) - 45) : 0), 0), 0) }))
    .sort((a, b) => b.size - a.size)
    .slice(0, 6);
  const g = (p: Player, x: number) => grade(league, displayOvr(p, x));
  const user = league.orgs[league.userOrgId];

  return (
    <>
      <h1>{season} Season Preview</h1>
      {!pv || pv.season !== season ? (
        <p className="muted small">The full preview (rising and declining players, draft recap) comes out when spring training opens. Projections below use current rosters.</p>
      ) : null}
      <div className="cards">
        <div className="box">
          <h3 style={{ marginTop: 0 }}>Projected wins</h3>
          <table className="data compact">
            <thead><tr><th className="l">Team</th><th>Proj</th><th>Last</th></tr></thead>
            <tbody>
              {[...proj].sort((a, b) => b.w - a.w).map(({ o, w, last }) => (
                <tr key={o.id} className={o.id === user.id ? 'user' : ''}>
                  <td className="l"><a href={href('roster', [], { org: o.id })}>{o.region} {o.name}</a></td>
                  <td>{w}</td>
                  <td className="muted">{last ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">From roster strength; not a guarantee.</p>
        </div>
        <div className="box">
          {withLast.length > 0 && (
            <>
              <h3 style={{ marginTop: 0 }}>Rising teams</h3>
              {rising.map(({ o, w, last }) => <div key={o.id}><a href={href('roster', [], { org: o.id })}>{o.region} {o.name}</a> <span className="pos">{last} → {w}</span></div>)}
              <h3>Falling teams</h3>
              {falling.map(({ o, w, last }) => <div key={o.id}><a href={href('roster', [], { org: o.id })}>{o.region} {o.name}</a> <span className="neg">{last} → {w}</span></div>)}
            </>
          )}
          {user.goals && user.goals.season === season && (
            <>
              <h3>Your owner's goals</h3>
              {user.goals.items.map((x) => <div key={x.type}>{x.text}</div>)}
            </>
          )}
          {fa.length > 0 && (
            <>
              <h3>Biggest free agent signings</h3>
              {fa.map((m) => {
                const p = league.players[m.sides[0].gets[0]];
                return <div key={m.id} className="small">{league.orgs[m.sides[0].orgId].abbrev}: {p ? <a href={href('player', [p.id])}>{p.first} {p.last}</a> : '?'} <span className="muted">{fmtMoney(m.cost)} total</span></div>;
              })}
            </>
          )}
          {trades.length > 0 && (
            <>
              <h3>Biggest trades</h3>
              {trades.map(({ m }) => <div key={m.id} className="small"><a href={href('move', [m.id])}>{m.text}</a></div>)}
            </>
          )}
        </div>
      </div>

      <div className="cards">
        <div className="box">
          <h3 style={{ marginTop: 0 }}>Top players</h3>
          <table className="data compact">
            <thead><tr><th className="l">Name</th><th>Pos</th><th>Age</th><th>Team</th><th>Lvl</th><th>Ovr</th><th>Pot</th></tr></thead>
            <tbody>{topPlayers.map((p) => <PlayerRow key={p.id} league={league} p={p} />)}</tbody>
          </table>
        </div>
        <div className="box">
          <h3 style={{ marginTop: 0 }}>Top prospects</h3>
          <table className="data compact">
            <thead><tr><th className="l">Name</th><th>Pos</th><th>Age</th><th>Team</th><th>Lvl</th><th>Ovr</th><th>Pot</th></tr></thead>
            <tbody>{topProspects.map((p) => <PlayerRow key={p.id} league={league} p={p} />)}</tbody>
          </table>
        </div>
      </div>

      {pv && pv.season === season && (
        <>
          <div className="cards">
            <div className="box">
              <h3 style={{ marginTop: 0 }}>Rising players</h3>
              <table className="data compact">
                <thead><tr><th className="l">Name</th><th>Pos</th><th>Age</th><th>Team</th><th>Lvl</th><th>Ovr</th></tr></thead>
                <tbody>
                  {pv.risers.map((r) => {
                    const p = league.players[r.pid];
                    return p ? <PlayerRow key={r.pid} league={league} p={p} extra={<td><span className="muted">{g(p, r.from)} →</span> <Rating v={g(p, r.to)} /></td>} /> : null;
                  })}
                </tbody>
              </table>
            </div>
            <div className="box">
              <h3 style={{ marginTop: 0 }}>Declining players</h3>
              <table className="data compact">
                <thead><tr><th className="l">Name</th><th>Pos</th><th>Age</th><th>Team</th><th>Lvl</th><th>Ovr</th></tr></thead>
                <tbody>
                  {pv.decliners.map((r) => {
                    const p = league.players[r.pid];
                    return p ? <PlayerRow key={r.pid} league={league} p={p} extra={<td><span className="muted">{g(p, r.from)} →</span> <Rating v={g(p, r.to)} /></td>} /> : null;
                  })}
                </tbody>
              </table>
            </div>
          </div>
          {pv.draft.length > 0 && (
            <div className="box">
              <h3 style={{ marginTop: 0 }}>{pv.draftSeason} draft: first round, one year later</h3>
              <table className="data compact">
                <thead><tr><th>Pick</th><th className="l">Drafted by</th><th className="l">Name</th><th>Pos</th><th>Age</th><th>Now</th><th>Lvl</th><th>Ovr</th><th>Pot</th></tr></thead>
                <tbody>
                  {pv.draft.map((d) => {
                    const p = league.players[d.pid];
                    if (!p) return null;
                    const now = p.retired ? 'Retired' : p.orgId === null ? (p.prospect ? 'Unsigned' : 'FA') : league.orgs[p.orgId].abbrev;
                    return (
                      <tr key={d.pick}>
                        <td>{d.pick}</td>
                        <td className="l">{league.orgs[d.orgId].abbrev}</td>
                        <td className="l"><a href={href('player', [p.id])}>{p.first} {p.last}</a></td>
                        <td>{posLabel(p)}</td>
                        <td>{league.season - p.born}</td>
                        <td>{now}</td>
                        <td>{p.level ?? '-'}</td>
                        <td><Rating v={scoutedOvr(league, p)} /></td>
                        <td><Rating v={scoutedPot(league, p)} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
