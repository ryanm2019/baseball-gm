// Compare 2-4 players side by side, and find similar players (past or
// present) by age, position and rating profile.
import { useState } from 'react';
import { useStore } from '../../store.ts';
import { href, useRoute } from '../../router.ts';
import type { League, Player } from '../../core/types.ts';
import { isPitcher, ovr, potOvr, scoutedOvr, scoutedPot } from '../../core/ratings.ts';
import { posLabel } from '../../core/rules.ts';
import { describeContract } from '../../core/terms.ts';
import { project } from '../../core/projections.ts';
import { careerWar } from '../../core/awards.ts';
import { avg, era, fmt3, obp, slg, seasonBat, seasonPit } from '../fmt.tsx';
import { emptyBat, emptyPit } from '../../core/util.ts';

// Similar players: closest by position group, age and the shape of the ratings
// at the time (uses each player's MLB seasons as snapshots of age + output).
export function similarPlayers(league: League, p: Player, n = 6): { q: Player; score: number }[] {
  const pit = isPitcher(p);
  const age = league.season - p.born;
  const vec = (x: Player) => (isPitcher(x)
    ? [x.ratings.pit.stuff, x.ratings.pit.control, x.ratings.pit.movement, x.ratings.pit.stamina / 2]
    : [x.ratings.vR.power, x.ratings.vR.eye, (x.ratings.vR.babip + x.ratings.vR.avoidK) / 2, x.ratings.run.speed / 2]);
  const v = vec(p);
  return Object.values(league.players)
    .filter((q) => q.id !== p.id && isPitcher(q) === pit && q.stats.some((e) => e.level === 'MLB') && (pit ? q.pos === p.pos : true))
    .map((q) => {
      const w = vec(q);
      const d = Math.sqrt(v.reduce((t, x, i) => t + (x - w[i]) ** 2, 0)) + Math.abs(league.season - q.born - age) * 1.5 + Math.abs(ovr(q) - ovr(p)) * 0.8 + (pit || q.pos === p.pos ? 0 : 4);
      return { q, score: Math.max(0, 100 - d * 3) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

export default function Compare() {
  const { league } = useStore();
  const route = useRoute();
  const initial = String(route.query.pids ?? '').split(',').filter(Boolean).map(Number);
  const [ids, setIds] = useState<number[]>(initial);
  const [q, setQ] = useState('');
  if (!league) return null;
  const ps = ids.map((id) => league.players[id]).filter(Boolean);
  const matches = q.length >= 2 ? Object.values(league.players).filter((p) => !ids.includes(p.id) && `${p.first} ${p.last}`.toLowerCase().includes(q.toLowerCase())).slice(0, 8) : [];
  const season = league.phase === 'offseason' || league.phase === 'preseason' ? league.season - (league.phase === 'preseason' ? 1 : 0) : league.season;
  const rows: [string, (p: Player) => string][] = [
    ['Team', (p) => (p.orgId !== null ? `${league.orgs[p.orgId].abbrev} (${p.level})` : 'Free agent')],
    ['Position', (p) => posLabel(p)],
    ['Age', (p) => String(league.season - p.born)],
    ['Overall / potential', (p) => `${scoutedOvr(league, p)} / ${scoutedPot(league, p)}`],
    ['Contract', (p) => describeContract(league, p.contract)],
    [`${season} line`, (p) => {
      if (isPitcher(p)) { const s = seasonPit(p, season) ?? emptyPit(); return s.outs ? `${s.w}-${s.l}, ${era(s).toFixed(2)} ERA, ${s.k} K in ${(s.outs / 3).toFixed(0)} IP` : '-'; }
      const b = seasonBat(p, season) ?? emptyBat();
      return b.pa ? `${fmt3(avg(b))}/${fmt3(obp(b))}/${fmt3(slg(b))}, ${b.hr} HR in ${b.pa} PA` : '-';
    }],
    ['Projection', (p) => { const pr = project(league, p); return `${pr.war.toFixed(1)} WAR (${pr.basis === 'stats' ? 'stats' : 'ratings'})`; }],
    ['Career MLB WAR', (p) => careerWar(league, p).toFixed(1)],
  ];
  if (ps.some((p) => !isPitcher(p))) rows.push(['Power / eye / contact / speed', (p) => (isPitcher(p) ? '-' : `${Math.round(p.ratings.vR.power)} / ${Math.round(p.ratings.vR.eye)} / ${Math.round((p.ratings.vR.babip + p.ratings.vR.avoidK) / 2)} / ${Math.round(p.ratings.run.speed)}`)]);
  if (ps.some(isPitcher)) rows.push(['Stuff / control / movement / stamina', (p) => (isPitcher(p) ? `${Math.round(p.ratings.pit.stuff)} / ${Math.round(p.ratings.pit.control)} / ${Math.round(p.ratings.pit.movement)} / ${Math.round(p.ratings.pit.stamina)}` : '-')]);
  void potOvr;
  return (
    <>
      <h1>Compare Players</h1>
      <div className="form-row">
        <input placeholder="Add a player (2 to 4)…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} disabled={ids.length >= 4} />{' '}
        {ids.length > 0 && <button className="btn btn-sm" onClick={() => setIds([])}>Clear</button>}
      </div>
      {matches.map((p) => (
        <div key={p.id} className="small"><button className="btn btn-sm" onClick={() => { setIds([...ids, p.id]); setQ(''); }}>Add</button> {p.first} {p.last} <span className="muted">{posLabel(p)}, {p.orgId !== null ? league.orgs[p.orgId].abbrev : 'FA'}</span></div>
      ))}
      {ps.length > 0 && (
        <table className="data compact" style={{ marginTop: 8 }}>
          <thead><tr><th className="l" />{ps.map((p) => <th key={p.id} className="l"><a href={href('player', [p.id])}>{p.first} {p.last}</a> <button className="btn btn-sm" onClick={() => setIds(ids.filter((x) => x !== p.id))}>×</button></th>)}</tr></thead>
          <tbody>{rows.map(([label, f]) => <tr key={label}><td className="l"><b>{label}</b></td>{ps.map((p) => <td key={p.id} className="l small">{f(p)}</td>)}</tr>)}</tbody>
        </table>
      )}
      {ps.length > 0 && (
        <>
          <h2>Similar to {ps[0].first} {ps[0].last}</h2>
          <p className="muted small">Closest by position, age and rating profile among players with MLB time in this league, past or present.</p>
          <table className="data compact" style={{ width: 'auto' }}>
            <tbody>
              {similarPlayers(league, ps[0]).map(({ q, score }) => (
                <tr key={q.id}>
                  <td className="l"><a href={href('player', [q.id])}>{q.first} {q.last}</a></td>
                  <td>{posLabel(q)}</td><td>{league.season - q.born}y</td><td>{q.retired ? 'Retired' : q.orgId !== null ? league.orgs[q.orgId].abbrev : 'FA'}</td>
                  <td>similarity {Math.round(score)}</td>
                  <td>{!ids.includes(q.id) && ids.length < 4 && <button className="btn btn-sm" onClick={() => setIds([...ids, q.id])}>Compare</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
