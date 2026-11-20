import { useStore } from '../../store.ts';
import { go, href, useRoute } from '../../router.ts';
import type { Level } from '../../core/types.ts';
import { dayLabel } from '../../core/settings.ts';
import { LevelTabs } from '../components.tsx';

export default function Scores() {
  const { league } = useStore();
  const route = useRoute();
  if (!league) return null;
  const level = (route.query.level ?? 'MLB') as Level;
  const lastPlayed = Math.max(0, league.day - 1);
  const day = route.query.day !== undefined ? Number(route.query.day) : lastPlayed;
  const games = league.schedule.filter((g) => g.level === level && g.day === day);
  return (
    <>
      <h1>Scores <span className="muted small">{dayLabel(league.season, day)}</span></h1>
      <LevelTabs value={level} onChange={(v) => go('scores', [], { level: v, day })} />
      <div className="form-row">
        <button className="btn btn-sm" onClick={() => go('scores', [], { level, day: day - 1 })} disabled={day <= 0}>‹ Prev day</button>
        <button className="btn btn-sm" onClick={() => go('scores', [], { level, day: day + 1 })}>Next day ›</button>
      </div>
      {games.length === 0 && <p className="muted">No games.</p>}
      <table className="data compact">
        <tbody>
          {games.map((g) => {
            const a = league.orgs[g.away];
            const h = league.orgs[g.home];
            const r = g.result;
            const mine = g.home === league.userOrgId || g.away === league.userOrgId;
            return (
              <tr key={g.id} className={mine ? 'user' : ''}>
                <td className="l">{a.affiliates[level].name}</td>
                <td>{r ? r.as : ''}</td>
                <td className="c">@</td>
                <td className="l">{h.affiliates[level].name}</td>
                <td>{r ? r.hs : ''}</td>
                <td className="l small">{r ? (r.innings > 9 ? `F/${r.innings}` : 'Final') : 'Scheduled'}{g.playoff ? ` · ${g.playoff.round} G${g.playoff.game}` : ''}</td>
                <td>{league.boxScores[g.id] && <a href={href('box', [g.id])}>Box</a>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">Box scores are kept for your organization's games and the playoffs.</p>
    </>
  );
}
