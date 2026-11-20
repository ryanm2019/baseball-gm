import { useStore, changed } from '../../store.ts';
import { href } from '../../router.ts';
import type { Control } from '../../core/types.ts';
import { LEVELS, MINOR_LEVELS } from '../../core/types.ts';
import { activeAt, orgPlayers } from '../../core/util.ts';
import { scoutedOvr, scoutedPot } from '../../core/ratings.ts';
import { farmDirectorOf } from '../../core/farmDirector.ts';
import { LEVEL_NAMES } from '../../core/settings.ts';
import { posLabel } from '../../core/rules.ts';
import { Rating } from '../components.tsx';

export default function Farm() {
  const { league } = useStore();
  if (!league) return null;
  const org = league.orgs[league.userOrgId];
  const fd = farmDirectorOf(league, org);
  const all = orgPlayers(league, org.id);

  const setAll = (c: Control) => {
    for (const l of MINOR_LEVELS) org.control[l] = c;
    changed();
  };

  return (
    <>
      <h1>Farm System</h1>
      <p>
        Farm director:{' '}
        {fd ? (
          <>
            <b>{fd.first} {fd.last}</b> · {fd.philosophy} · development {fd.development}, evaluation {fd.evaluation}
          </>
        ) : (
          <b className="neg">none</b>
        )}{' '}
        <a href={href('staff')}>Staff</a>
      </p>
      <p className="muted small">
        Affiliates set to "Farm director" are run by him: lineups, rotations, injuries, filling holes, and promotions and demotions based on his read of each player and his philosophy. Set a level to "Me" to make every move there yourself. MLB call-ups are always yours, except injury replacements when "Auto MLB roster moves" is on in League Settings.
      </p>
      <div className="form-row">
        <button className="btn btn-sm" onClick={() => setAll('FD')}>All levels: farm director</button>
        <button className="btn btn-sm" onClick={() => setAll('Manual')}>All levels: me</button>
      </div>
      <table className="data">
        <thead>
          <tr><th className="l">Level</th><th className="l">Affiliate</th><th>W-L</th><th>Active</th><th>Avg age</th><th className="l">Managed by</th><th className="l">Top prospects (scouted pot)</th></tr>
        </thead>
        <tbody>
          {LEVELS.map((l) => {
            const act = activeAt(league, org.id, l);
            const r = league.standings[l][org.id];
            const top = all
              .filter((p) => p.level === l && !p.dfa && !p.waivers && league.season - p.born <= 25)
              .sort((a, b) => scoutedPot(league, b) - scoutedPot(league, a) || scoutedOvr(league, b) - scoutedOvr(league, a))
              .slice(0, 3);
            const ages = act.map((p) => league.season - p.born);
            return (
              <tr key={l}>
                <td className="l">{l}</td>
                <td className="l"><a href={href('roster', [], { level: l })}>{org.affiliates[l].name}</a> <span className="muted small">{LEVEL_NAMES[l]}</span></td>
                <td>{r.w}-{r.l}</td>
                <td>{act.length}/{league.settings.milbActiveMax[l]}</td>
                <td>{ages.length ? (ages.reduce((s, x) => s + x, 0) / ages.length).toFixed(1) : '-'}</td>
                <td className="l">
                  {l === 'MLB' ? (
                    <span>You</span>
                  ) : (
                    <select value={org.control[l]} onChange={(e) => { org.control[l] = e.target.value as Control; changed(); }}>
                      <option value="FD">Farm director</option>
                      <option value="Manual">Me</option>
                    </select>
                  )}
                </td>
                <td className="l">
                  {top.map((p) => (
                    <span key={p.id} style={{ marginRight: 12 }}>
                      <a href={href('player', [p.id])}>{p.first} {p.last}</a> <span className="muted small">{posLabel(p)}, {league.season - p.born}</span> <Rating v={scoutedPot(league, p)} />
                    </span>
                  ))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
