// Set your 26 for the current playoff round.
import { useState } from 'react';
import { useStore, changed, setMessage } from '../../store.ts';
import { href } from '../../router.ts';
import { PO_MAX_P, PO_SIZE, autoPlayoffRoster, playoffCandidates, roundOf, validatePlayoffRoster } from '../../core/playoffRoster.ts';
import { isPitcher, scoutedOvr } from '../../core/ratings.ts';
import { posLabel } from '../../core/rules.ts';

const ROUND: Record<string, string> = { WC: 'Wild Card Series', DS: 'Division Series', CS: 'League Championship Series', WS: 'World Series' };

export default function PlayoffRoster() {
  const { league } = useStore();
  const [, force] = useState(0);
  if (!league) return null;
  const org = league.orgs[league.userOrgId];
  const round = roundOf(league, org.id);
  if (league.phase !== 'playoffs' || !round || !league.playoffs) return <><h1>Playoff Roster</h1><p className="muted">You're not in a playoff series right now. When you are, set your 26 for each round here.</p></>;
  const key = `${round}:${org.id}`;
  league.playoffs.rosters ??= {};
  const ids = league.playoffs.rosters[key] ?? autoPlayoffRoster(league, org.id);
  const sel = new Set(ids);
  const cands = playoffCandidates(league, org.id).sort((a, b) => Number(isPitcher(a)) - Number(isPitcher(b)) || scoutedOvr(league, b) - scoutedOvr(league, a));
  const err = validatePlayoffRoster(league, org.id, ids);
  const toggle = (id: number) => {
    const next = sel.has(id) ? ids.filter((x) => x !== id) : [...ids, id];
    league.playoffs!.rosters![key] = next;
    changed();
    force((x) => x + 1);
  };
  const nP = ids.filter((id) => isPitcher(league.players[id])).length;
  return (
    <>
      <h1>Playoff Roster: {ROUND[round]}</h1>
      <p className="small">{ids.length}/{PO_SIZE} players · {nP}/{PO_MAX_P} pitchers. Only players in your organization by August 31 (on the 40-man) are eligible. You can change it before each round; injured players can be swapped out any time.</p>
      {err ? <div className="alert alert-warn small">{err}. Until it's fixed, your assistant's roster is used.</div> : <div className="alert alert-info small">Roster set.</div>}
      <button className="btn btn-sm" onClick={() => { league.playoffs!.rosters![key] = autoPlayoffRoster(league, org.id); changed(); setMessage('Roster reset to your assistant\'s picks.'); }}>Reset to assistant's picks</button>
      <table className="data compact" style={{ width: 'auto', marginTop: 8 }}>
        <thead><tr><th /><th className="l">Player</th><th>Pos</th><th>Ovr</th><th>Level</th><th className="l">Status</th></tr></thead>
        <tbody>
          {cands.map((p) => (
            <tr key={p.id} className={sel.has(p.id) ? 'user' : ''}>
              <td><input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p.id)} /></td>
              <td className="l"><a href={href('player', [p.id])}>{p.first} {p.last}</a></td>
              <td>{posLabel(p)}</td>
              <td>{scoutedOvr(league, p)}</td>
              <td>{p.level}</td>
              <td className="l small">{p.injury ? `${p.injury.name} (${p.injury.daysLeft}d)` : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
