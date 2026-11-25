import { useStore } from '../../store.ts';
import { href, useRoute } from '../../router.ts';
import { dayLabel } from '../../core/settings.ts';
import { ipStr } from '../fmt.tsx';
import { TeamBadge, teamColor } from '../show.tsx';

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
  const game = league.schedule.find((g) => g.id === box.gid);
  const res = game?.result;
  const winner = runs(box.lineScore.home) > runs(box.lineScore.away) ? 'home' : 'away';
  const dec = (pid: number | null | undefined, label: string) => (pid != null && league.players[pid] ? <span><b>{label}:</b> {name(pid)}</span> : null);
  return (
    <>
      <div className="show show-banner">
        <div className="box-banner">
          {(['away', 'home'] as const).map((side) => {
            const o = side === 'away' ? away : home;
            const st = league.standings[box.level][o.id];
            return (
              <div key={side} className={`bb-team ${side}${winner === side ? ' win' : ''}`}>
                <TeamBadge league={league} orgId={o.id} size={56} />
                <div className="bb-name"><span>{o.affiliates[box.level].name}</span><i>{st ? `${st.w}-${st.l}` : ''}</i></div>
                <div className="bb-runs">{runs(box.lineScore[side])}</div>
              </div>
            );
          })}
          <div className="bb-status">
            <b>{res && res.innings > 9 ? `Final/${res.innings}` : 'Final'}</b>
            <span>{box.level} · {dayLabel(league.season, box.day)}</span>
          </div>
        </div>
        <table className="stable linescore dark-ls">
          <thead>
            <tr>
              <th className="l" />
              {Array.from({ length: innings }, (_, i) => <th key={i}>{i + 1}</th>)}
              <th className="tot">R</th><th className="tot">H</th><th className="tot">E</th>
            </tr>
          </thead>
          <tbody>
            {(['away', 'home'] as const).map((side) => (
              <tr key={side}>
                <td className="l"><TeamBadge league={league} orgId={(side === 'away' ? away : home).id} size={22} /> <b>{(side === 'away' ? away : home).abbrev}</b></td>
                {Array.from({ length: innings }, (_, i) => <td key={i}>{box.lineScore[side][i] ?? (side === 'home' && i >= box.lineScore.home.length ? 'x' : '')}</td>)}
                <td className="tot"><b>{runs(box.lineScore[side])}</b></td><td className="tot">{box.hits[side]}</td><td className="tot">{box.errors[side]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {res && <div className="bb-dec">{dec(res.wp, 'W')}{dec(res.lp, 'L')}{dec(res.sv, 'SV')}</div>}
      </div>
      {box.notes.length > 0 && <p className="small">{box.notes.join('. ')}.</p>}
      <div className="cards">
        {(['away', 'home'] as const).map((side) => (
          <div key={side} className="box">
            <h3 className="team-head" style={{ borderColor: teamColor((side === 'away' ? away : home).id) }}><TeamBadge league={league} orgId={(side === 'away' ? away : home).id} size={24} /> {(side === 'away' ? away : home).affiliates[box.level].name}</h3>
            <table className="data compact">
              <thead><tr><th className="l">Batter</th><th>Pos</th><th>AB</th><th>R</th><th>H</th><th>RBI</th><th>BB</th><th>K</th><th>HR</th></tr></thead>
              <tbody>
                {box.bat[side].map((b) => (
                  <tr key={b.pid}>
                    <td className="l">{name(b.pid)}</td><td>{b.pos}</td><td>{b.ab}</td><td>{b.r}</td><td>{b.h}</td><td>{b.rbi}</td><td>{b.bb}</td><td>{b.k}</td><td>{b.hr || ''}</td>
                  </tr>
                ))}
                {(() => { const t = box.bat[side].reduce((a, b) => ({ ab: a.ab + b.ab, r: a.r + b.r, h: a.h + b.h, rbi: a.rbi + b.rbi, bb: a.bb + b.bb, k: a.k + b.k, hr: a.hr + b.hr }), { ab: 0, r: 0, h: 0, rbi: 0, bb: 0, k: 0, hr: 0 });
                  return <tr className="totals"><td className="l">Totals</td><td /><td>{t.ab}</td><td>{t.r}</td><td>{t.h}</td><td>{t.rbi}</td><td>{t.bb}</td><td>{t.k}</td><td>{t.hr || ''}</td></tr>; })()}
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
