import { useStore } from '../../store.ts';
import { go, href, useRoute } from '../../router.ts';
import type { Level } from '../../core/types.ts';
import { dayShort } from '../../core/settings.ts';
import { LevelTabs } from '../components.tsx';

export default function Schedule() {
  const { league } = useStore();
  const route = useRoute();
  if (!league) return null;
  const level = (route.query.level ?? 'MLB') as Level;
  const org = league.orgs[league.userOrgId];
  const games = league.schedule.filter((g) => g.level === level && (g.home === org.id || g.away === org.id));
  let w = 0;
  let l = 0;
  return (
    <>
      <h1>Schedule <span className="muted small">{org.affiliates[level].name}</span></h1>
      <LevelTabs value={level} onChange={(v) => go('schedule', [], { level: v })} />
      <table className="data compact">
        <thead>
          <tr><th className="l">Date</th><th className="l">Opponent</th><th className="l">Result</th><th>Record</th><th className="l">W / L / S</th><th /></tr>
        </thead>
        <tbody>
          {games.map((g) => {
            const home = g.home === org.id;
            const opp = league.orgs[home ? g.away : g.home];
            let res = '';
            let cls = '';
            if (g.result) {
              const us = home ? g.result.hs : g.result.as;
              const them = home ? g.result.as : g.result.hs;
              if (!g.playoff) {
                if (us > them) w++;
                else l++;
              }
              res = `${us > them ? 'W' : 'L'} ${us}-${them}${g.result.innings > 9 ? ` (${g.result.innings})` : ''}`;
              cls = us > them ? 'pos' : 'neg';
            }
            const pn = (id: number | null) => (id ? league.players[id]?.last ?? '' : '');
            return (
              <tr key={g.id} className={g.day === league.day ? 'user' : ''}>
                <td className="l">{dayShort(league.season, g.day)}{g.playoff ? ` (${g.playoff.round} G${g.playoff.game})` : ''}</td>
                <td className="l">{home ? 'vs' : '@'} {opp.affiliates[level].name}</td>
                <td className={`l ${cls}`}>{res}</td>
                <td>{g.result && !g.playoff ? `${w}-${l}` : ''}</td>
                <td className="l small">{g.result ? [pn(g.result.wp), pn(g.result.lp), pn(g.result.sv)].filter(Boolean).join(' / ') : ''}</td>
                <td>{league.boxScores[g.id] && <a href={href('box', [g.id])}>Box</a>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
