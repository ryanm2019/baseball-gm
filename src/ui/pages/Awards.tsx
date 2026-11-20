// Awards by season: MVP, Cy Young, Rookie of the Year, Reliever of the Year,
// Gold Gloves, Silver Sluggers and All-Stars.
import { useState } from 'react';
import { useStore } from '../../store.ts';
import { href } from '../../router.ts';
import type { AwardName } from '../../core/types.ts';

const ORDER: AwardName[] = ['MVP', 'Cy Young', 'Rookie of the Year', 'Reliever of the Year', 'Silver Slugger', 'Gold Glove', 'All-Star'];

export default function Awards() {
  const { league } = useStore();
  const seasons = [...new Set((league?.awards ?? []).map((a) => a.season))].sort((a, b) => b - a);
  const [season, setSeason] = useState<number | null>(null);
  if (!league) return null;
  const s = season ?? seasons[0];
  if (s === undefined) return <><h1>Awards</h1><p className="muted">No awards yet. All-Stars are named at the All-Star break; season awards after the World Series.</p></>;
  const recs = (league.awards ?? []).filter((a) => a.season === s);
  return (
    <>
      <h1>Awards</h1>
      <select value={s} onChange={(e) => setSeason(Number(e.target.value))}>{seasons.map((x) => <option key={x} value={x}>{x}</option>)}</select>
      <div className="row" style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        {(['AL', 'NL'] as const).map((lg) => (
          <div key={lg} style={{ flex: '1 1 420px' }}>
            <h2>{lg}</h2>
            <table className="data compact">
              <thead><tr><th className="l">Award</th><th className="l">Player</th><th>Team</th><th className="l">Season</th></tr></thead>
              <tbody>
                {ORDER.flatMap((aw) => recs.filter((r) => r.lg === lg && r.award === aw).map((r, i) => {
                  const p = league.players[r.pid];
                  return (
                    <tr key={`${aw}${i}`} className={r.orgId === league.userOrgId ? 'user' : ''}>
                      <td className="l">{aw}{r.pos ? ` (${r.pos})` : ''}</td>
                      <td className="l">{p ? <a href={href('player', [p.id])}>{p.first} {p.last}</a> : '?'}</td>
                      <td>{league.orgs[r.orgId]?.abbrev}</td>
                      <td className="l small">{r.line}</td>
                    </tr>
                  );
                }))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </>
  );
}
