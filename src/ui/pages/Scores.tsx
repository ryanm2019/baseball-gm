import { useStore } from '../../store.ts';
import { go, href, useRoute } from '../../router.ts';
import type { Level } from '../../core/types.ts';
import { dayLabel } from '../../core/settings.ts';
import { LevelTabs } from '../components.tsx';
import { TeamBadge } from '../show.tsx';

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
      <div className="score-grid">
        {games.map((g) => {
          const r = g.result;
          const mine = g.home === league.userOrgId || g.away === league.userOrgId;
          const box = league.boxScores[g.id];
          const pn = (pid: number | null) => (pid != null && league.players[pid] ? league.players[pid].last : null);
          return (
            <div key={g.id} className={`score-card${mine ? ' mine' : ''}`}>
              {(['away', 'home'] as const).map((side) => {
                const o = league.orgs[side === 'away' ? g.away : g.home];
                const runs = r ? (side === 'away' ? r.as : r.hs) : null;
                const won = r && runs !== null && runs > (side === 'away' ? r.hs : r.as);
                const st = league.standings[level][o.id];
                return (
                  <div key={side} className={`sc-row${won ? ' win' : ''}`}>
                    <TeamBadge league={league} orgId={o.id} size={26} />
                    <span className="sc-name">{o.affiliates[level].name}</span>
                    <span className="sc-rec">{st ? `${st.w}-${st.l}` : ''}</span>
                    <span className="sc-runs">{runs ?? ''}</span>
                  </div>
                );
              })}
              <div className="sc-foot">
                <span className="sc-status">{r ? (r.innings > 9 ? `Final/${r.innings}` : 'Final') : 'Scheduled'}{g.playoff ? ` · ${g.playoff.round} G${g.playoff.game}` : ''}</span>
                {r && <span className="sc-dec">{[pn(r.wp) && `W: ${pn(r.wp)}`, pn(r.lp) && `L: ${pn(r.lp)}`, pn(r.sv) && `S: ${pn(r.sv)}`].filter(Boolean).join(' · ')}</span>}
                {box && <a href={href('box', [g.id])}>Box score</a>}
              </div>
            </div>
          );
        })}
      </div>
      <p className="muted small">Box scores are kept for your organization's games and the playoffs.</p>
    </>
  );
}
