import { useStore } from '../../store.ts';
import { href, useRoute } from '../../router.ts';
import { dayLabel } from '../../core/settings.ts';
import { ipStr } from '../fmt.tsx';

export default function Box() {
  const { league } = useStore();
  const route = useRoute();
  if (!league) return null;
  const box = league.boxScores[Number(route.args[0])];
  if (!box) return <p>Box score not available.</p>;
  const away = league.orgs[box.away];
  const home = league.orgs[box.home];
  const innings = Math.max(box.lineScore.away.length, box.lineScore.home.length, 9);
  const name = (pid: number) => {
    const p = league.players[pid];
    return p ? <a href={href('player', [pid])}>{p.first[0]}. {p.last}</a> : '?';
  };
  const runs = (a: number[]) => a.reduce((s, x) => s + x, 0);
  return (
    <>
      <h1>
        {away.affiliates[box.level].name} {runs(box.lineScore.away)}, {home.affiliates[box.level].name} {runs(box.lineScore.home)}
      </h1>
      <p className="muted">{box.level} · {dayLabel(league.season, box.day)}</p>
      <table className="data compact linescore">
        <thead>
          <tr>
            <th className="l" />
            {Array.from({ length: innings }, (_, i) => <th key={i}>{i + 1}</th>)}
            <th>R</th><th>H</th><th>E</th>
          </tr>
        </thead>
        <tbody>
          {(['away', 'home'] as const).map((side) => (
            <tr key={side}>
              <td className="l">{(side === 'away' ? away : home).abbrev}</td>
              {Array.from({ length: innings }, (_, i) => <td key={i}>{box.lineScore[side][i] ?? (side === 'home' && i >= box.lineScore.home.length ? 'x' : '')}</td>)}
              <td><b>{runs(box.lineScore[side])}</b></td><td>{box.hits[side]}</td><td>{box.errors[side]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {box.notes.length > 0 && <p className="small">{box.notes.join('. ')}.</p>}
      <div className="cards">
        {(['away', 'home'] as const).map((side) => (
          <div key={side} className="box">
            <h3>{(side === 'away' ? away : home).affiliates[box.level].name}</h3>
            <table className="data compact">
              <thead><tr><th className="l">Batter</th><th>Pos</th><th>AB</th><th>R</th><th>H</th><th>RBI</th><th>BB</th><th>K</th><th>HR</th></tr></thead>
              <tbody>
                {box.bat[side].map((b) => (
                  <tr key={b.pid}>
                    <td className="l">{name(b.pid)}</td><td>{b.pos}</td><td>{b.ab}</td><td>{b.r}</td><td>{b.h}</td><td>{b.rbi}</td><td>{b.bb}</td><td>{b.k}</td><td>{b.hr || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="data compact">
              <thead><tr><th className="l">Pitcher</th><th>IP</th><th>H</th><th>R</th><th>ER</th><th>BB</th><th>K</th><th>HR</th><th>Pit</th></tr></thead>
              <tbody>
                {box.pit[side].map((p) => (
                  <tr key={p.pid}>
                    <td className="l">{name(p.pid)} {p.dec && <span className="muted">({p.dec})</span>}</td>
                    <td>{ipStr(p.outs)}</td><td>{p.h}</td><td>{p.r}</td><td>{p.er}</td><td>{p.bb}</td><td>{p.k}</td><td>{p.hr || ''}</td><td>{p.pitches}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </>
  );
}
