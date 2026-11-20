import { useStore } from '../../store.ts';
import type { PlayoffSeries } from '../../core/types.ts';

const ROUNDS: [PlayoffSeries['round'], string][] = [
  ['WC', 'Wild Card (best of 3)'],
  ['DS', 'Division Series (best of 5)'],
  ['CS', 'Championship Series (best of 7)'],
  ['WS', 'World Series (best of 7)'],
];

export default function Playoffs() {
  const { league } = useStore();
  if (!league) return null;
  const po = league.playoffs;
  const champs = league.champions.filter((c) => c.season === league.season);
  return (
    <>
      <h1>{league.season} Playoffs</h1>
      {!po && <p className="muted">The playoffs start after the regular season: 6 teams per league (3 division winners and 3 wild cards). The top two seeds get a bye.</p>}
      {po && (
        <>
          <div className="cards">
            {(['AL', 'NL'] as const).map((lg) => (
              <div key={lg} className="box">
                <h3>{lg} seeds</h3>
                {po.seeds[lg].map((id, i) => (
                  <div key={id} className={id === league.userOrgId ? 'pos' : ''}>
                    {i + 1}. {league.orgs[id].region} {league.orgs[id].name} ({league.standings.MLB[id].w}-{league.standings.MLB[id].l})
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="bracket">
            {ROUNDS.map(([r, label]) => {
              const ss = po.series.filter((s) => s.round === r);
              return (
                <div key={r} className="round">
                  <h3>{label}</h3>
                  {ss.length === 0 && <p className="muted small">TBD</p>}
                  {ss.map((s) => (
                    <div key={s.id} className="series">
                      <div className="muted small">{s.league}</div>
                      {[s.high, s.low].map((id, i) => (
                        <div key={id} className={s.winner === id ? 'w' : ''}>
                          {league.orgs[id].region} {league.orgs[id].name} <span style={{ float: 'right' }}>{s.wins[i]}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          {po.champion !== null && (
            <h2>
              Champion: {league.orgs[po.champion].region} {league.orgs[po.champion].name}
            </h2>
          )}
        </>
      )}
      {champs.filter((c) => c.level !== 'MLB').length > 0 && (
        <>
          <h3>Minor league regular-season champions</h3>
          {champs
            .filter((c) => c.level !== 'MLB')
            .map((c) => (
              <div key={c.level}>
                {c.level}: {league.orgs[c.orgId].affiliates[c.level].name}
              </div>
            ))}
        </>
      )}
    </>
  );
}
