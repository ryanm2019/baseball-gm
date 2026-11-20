// League history: seasons (champions and award winners), a franchise's year
// by year record, single-season and career records, and the Hall of Fame.
import { useMemo, useState } from 'react';
import { useStore } from '../../store.ts';
import { href } from '../../router.ts';
import type { League, Player } from '../../core/types.ts';
import { isPitcher } from '../../core/ratings.ts';
import { careerWar, hofScore } from '../../core/awards.ts';
import { entryWar } from '../../core/war.ts';

type Tab = 'seasons' | 'franchise' | 'records' | 'hof';

const PL = ({ league, pid }: { league: League; pid: number }) => {
  const p = league.players[pid];
  return p ? <a href={href('player', [p.id])}>{p.first} {p.last}</a> : <span>?</span>;
};

interface PS { p: Player; season: number; orgId: number; pa: number; ab: number; h: number; hr: number; rbi: number; sb: number; w: number; k: number; sv: number; outs: number; er: number; war: number }

function playerSeasons(league: League): PS[] {
  const out: PS[] = [];
  for (const p of Object.values(league.players)) {
    const bySeason = new Map<number, PS>();
    for (const e of p.stats) {
      if (e.level !== 'MLB') continue;
      const x = bySeason.get(e.season) ?? { p, season: e.season, orgId: e.orgId, pa: 0, ab: 0, h: 0, hr: 0, rbi: 0, sb: 0, w: 0, k: 0, sv: 0, outs: 0, er: 0, war: 0 };
      x.pa += e.bat.pa; x.ab += e.bat.ab; x.h += e.bat.h; x.hr += e.bat.hr; x.rbi += e.bat.rbi; x.sb += e.bat.sb;
      x.w += e.pit.w; x.k += e.pit.k; x.sv += e.pit.sv; x.outs += e.pit.outs; x.er += e.pit.er;
      if (e.bat.pa >= 150 || e.pit.outs >= 150) x.war += entryWar(league, p, e);
      bySeason.set(e.season, x);
    }
    out.push(...bySeason.values());
  }
  return out;
}

export default function History() {
  const { league } = useStore();
  const [tab, setTab] = useState<Tab>('seasons');
  const [orgId, setOrgId] = useState<number | null>(null);
  const data = useMemo(() => {
    if (!league || tab !== 'records') return null;
    const ps = playerSeasons(league);
    const careers = new Map<number, PS>();
    for (const x of ps) {
      const c = careers.get(x.p.id) ?? { ...x, season: 0, pa: 0, ab: 0, h: 0, hr: 0, rbi: 0, sb: 0, w: 0, k: 0, sv: 0, outs: 0, er: 0, war: 0 };
      c.pa += x.pa; c.ab += x.ab; c.h += x.h; c.hr += x.hr; c.rbi += x.rbi; c.sb += x.sb; c.w += x.w; c.k += x.k; c.sv += x.sv; c.outs += x.outs; c.er += x.er;
      careers.set(x.p.id, c);
    }
    const cs = [...careers.values()];
    for (const c of cs) c.war = c.pa >= 1500 || c.outs >= 1500 ? careerWar(league, c.p) : 0;
    return { ps, cs };
  }, [league, tab, league?.season, league?.phase]);
  if (!league) return null;
  const org = league.orgs[orgId ?? league.userOrgId];
  const seasons = [...new Set([...(league.seasonRecs ?? []).map((r) => r.season), ...league.champions.filter((c) => c.level === 'MLB').map((c) => c.season)])].sort((a, b) => b - a);

  const top = <T,>(xs: T[], f: (x: T) => number, n = 10, asc = false) => [...xs].sort((a, b) => (asc ? f(a) - f(b) : f(b) - f(a))).slice(0, n);
  const board = (title: string, rows: PS[], f: (x: PS) => number, fmt: (x: PS) => string, career: boolean) => (
    <div key={title} style={{ flex: '1 1 260px' }}>
      <h3>{title}</h3>
      <table className="data compact">
        <tbody>
          {rows.map((x, i) => (
            <tr key={i}><td>{i + 1}</td><td className="l"><PL league={league} pid={x.p.id} /></td><td>{career ? '' : `${x.season} ${league.orgs[x.orgId]?.abbrev ?? ''}`}</td><td>{fmt(x)}</td></tr>
          ))}
        </tbody>
      </table>
      {void f}
    </div>
  );

  return (
    <>
      <h1>History</h1>
      <div className="btn-group tabs">
        {(['seasons', 'franchise', 'records', 'hof'] as Tab[]).map((t) => (
          <button key={t} className={`btn btn-sm${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            {t === 'seasons' ? 'Seasons' : t === 'franchise' ? 'Franchise' : t === 'records' ? 'Records' : 'Hall of Fame'}
          </button>
        ))}
      </div>

      {tab === 'seasons' && (
        <table className="data compact">
          <thead><tr><th>Season</th><th className="l">Champion</th><th className="l">Best record</th><th className="l">AL MVP</th><th className="l">NL MVP</th><th className="l">AL Cy Young</th><th className="l">NL Cy Young</th></tr></thead>
          <tbody>
            {seasons.map((s) => {
              const ch = league.champions.find((c) => c.season === s && c.level === 'MLB');
              const recs = (league.seasonRecs ?? []).filter((r) => r.season === s);
              const best = recs.sort((a, b) => b.w - a.w)[0];
              const aw = (award: string, lg: string) => (league.awards ?? []).find((a) => a.season === s && a.award === award && a.lg === lg);
              const cell = (award: string, lg: string) => { const a = aw(award, lg); return a ? <PL league={league} pid={a.pid} /> : '-'; };
              return (
                <tr key={s}>
                  <td>{s}</td>
                  <td className="l">{ch ? `${league.orgs[ch.orgId].region} ${league.orgs[ch.orgId].name}` : '-'}</td>
                  <td className="l">{best ? `${league.orgs[best.orgId].abbrev} ${best.w}-${best.l}` : '-'}</td>
                  <td className="l">{cell('MVP', 'AL')}</td><td className="l">{cell('MVP', 'NL')}</td><td className="l">{cell('Cy Young', 'AL')}</td><td className="l">{cell('Cy Young', 'NL')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {tab === 'franchise' && (
        <>
          <select value={org.id} onChange={(e) => setOrgId(Number(e.target.value))}>
            {league.orgs.map((o) => <option key={o.id} value={o.id}>{o.region} {o.name}</option>)}
          </select>
          <p className="small">
            Championships: <b>{league.champions.filter((c) => c.level === 'MLB' && c.orgId === org.id).map((c) => c.season).join(', ') || 'none yet'}</b> ·
            Hall of Famers who played for them: <b>{(league.hof ?? []).filter((h) => league.players[h.pid]?.stats.some((e) => e.orgId === org.id && e.level === 'MLB')).length}</b>
          </p>
          <table className="data compact" style={{ width: 'auto' }}>
            <thead><tr><th>Season</th><th>W</th><th>L</th><th>Pct</th><th className="l">Result</th><th className="l">Award winners</th></tr></thead>
            <tbody>
              {(league.seasonRecs ?? []).filter((r) => r.orgId === org.id).sort((a, b) => b.season - a.season).map((r) => (
                <tr key={r.season}>
                  <td>{r.season}</td><td>{r.w}</td><td>{r.l}</td><td>{(r.w / Math.max(1, r.w + r.l)).toFixed(3).replace(/^0/, '')}</td><td className="l">{r.result || '-'}</td>
                  <td className="l small">{(league.awards ?? []).filter((a) => a.season === r.season && a.orgId === org.id && a.award !== 'All-Star').map((a, i) => <span key={i}>{a.award}: <PL league={league} pid={a.pid} />{' '}</span>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {tab === 'records' && data && (
        <>
          <h2>Single season</h2>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {board('Home runs', top(data.ps, (x) => x.hr), (x) => x.hr, (x) => String(x.hr), false)}
            {board('Batting average (502 PA)', top(data.ps.filter((x) => x.pa >= 502), (x) => x.h / Math.max(1, x.ab)), (x) => x.h / x.ab, (x) => (x.h / Math.max(1, x.ab)).toFixed(3).replace(/^0/, ''), false)}
            {board('RBI', top(data.ps, (x) => x.rbi), (x) => x.rbi, (x) => String(x.rbi), false)}
            {board('Stolen bases', top(data.ps, (x) => x.sb), (x) => x.sb, (x) => String(x.sb), false)}
            {board('WAR', top(data.ps, (x) => x.war), (x) => x.war, (x) => x.war.toFixed(1), false)}
            {board('Wins', top(data.ps, (x) => x.w), (x) => x.w, (x) => String(x.w), false)}
            {board('Strikeouts', top(data.ps, (x) => x.k), (x) => x.k, (x) => String(x.k), false)}
            {board('ERA (162 IP)', top(data.ps.filter((x) => x.outs >= 486), (x) => (x.er * 27) / x.outs, 10, true), (x) => x.er, (x) => ((x.er * 27) / x.outs).toFixed(2), false)}
            {board('Saves', top(data.ps, (x) => x.sv), (x) => x.sv, (x) => String(x.sv), false)}
          </div>
          <h2>Career</h2>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {board('Home runs', top(data.cs, (x) => x.hr), (x) => x.hr, (x) => String(x.hr), true)}
            {board('Hits', top(data.cs, (x) => x.h), (x) => x.h, (x) => String(x.h), true)}
            {board('RBI', top(data.cs, (x) => x.rbi), (x) => x.rbi, (x) => String(x.rbi), true)}
            {board('Stolen bases', top(data.cs, (x) => x.sb), (x) => x.sb, (x) => String(x.sb), true)}
            {board('WAR', top(data.cs, (x) => x.war), (x) => x.war, (x) => x.war.toFixed(1), true)}
            {board('Wins', top(data.cs, (x) => x.w), (x) => x.w, (x) => String(x.w), true)}
            {board('Strikeouts', top(data.cs, (x) => x.k), (x) => x.k, (x) => String(x.k), true)}
            {board('Saves', top(data.cs, (x) => x.sv), (x) => x.sv, (x) => String(x.sv), true)}
          </div>
          <p className="muted small">Records cover this league's history (players who left the league's database before the archive started aren't included).</p>
        </>
      )}

      {tab === 'hof' && (
        <>
          <h2>Hall of Fame</h2>
          {!(league.hof ?? []).length && <p className="muted">No one has been elected yet. Players become eligible five seasons after they retire; 75% of the vote gets them in.</p>}
          <table className="data compact">
            <tbody>
              {[...(league.hof ?? [])].sort((a, b) => b.season - a.season).map((h) => (
                <tr key={h.pid}><td>{h.season}</td><td className="l"><PL league={league} pid={h.pid} /></td><td>{league.players[h.pid] ? (isPitcher(league.players[h.pid]) ? 'P' : league.players[h.pid].pos) : ''}</td><td>{h.pct.toFixed(1)}%</td><td>{h.ballot === 1 ? 'First ballot' : `Year ${h.ballot}`}</td><td className="l small">{h.line}</td></tr>
              ))}
            </tbody>
          </table>
          <h2>On the ballot</h2>
          <table className="data compact">
            <tbody>
              {Object.entries(league.hofBallot ?? {}).filter(([, y]) => y > 0).map(([pid, y]) => ({ p: league.players[Number(pid)], y })).filter((x) => x.p).map((x) => ({ ...x, h: hofScore(league, x.p) })).sort((a, b) => b.h.score - a.h.score).slice(0, 25).map((x) => (
                <tr key={x.p.id}><td className="l"><PL league={league} pid={x.p.id} /></td><td>Year {x.y}</td><td className="l small">{x.h.line}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
