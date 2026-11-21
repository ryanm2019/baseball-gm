import { useStore, changed } from '../../store.ts';
import { href } from '../../router.ts';
import { arbProjection, arbStatus, controlledExpiring, settleArb, superTwoSet } from '../../core/offseason.ts';
import { fmtMoney, marketValue, roundSalary, serviceLabel } from '../../core/contracts.ts';
import { posLabel } from '../../core/rules.ts';
import { orgPlayers } from '../../core/util.ts';
import { scoutedOvr } from '../../core/ratings.ts';
import { Rating, NumInput } from '../components.tsx';
import { delegated } from '../../core/staff.ts';

export default function Tenders() {
  const { league } = useStore();
  if (!league) return null;
  const org = league.orgs[league.userOrgId];
  const s = league.settings;
  const tenderDone = league.events.includes('tender');
  const exchanged = league.events.includes('arb-exchange');
  const super2 = superTwoSet(league);
  const pending = league.phase === 'offseason' && !tenderDone ? controlledExpiring(league, org.id) : [];
  const cases = orgPlayers(league, org.id).filter((p) => p.arb);

  return (
    <>
      <h1>Tenders & Arbitration</h1>
      {delegated(league, org, 'tender') && <p className="muted">Your assistant GM is making tender decisions.</p>}
      <h2>Tender decisions {league.phase === 'offseason' && !tenderDone && <span className="muted small">(due at the non-tender deadline)</span>}</h2>
      {pending.length === 0 ? (
        <p className="muted">{tenderDone ? 'The non-tender deadline has passed.' : 'Nothing to decide right now. Players under club control with expiring contracts show up here after the season.'}</p>
      ) : (
        <table className="data compact">
          <thead><tr><th className="l">Player</th><th>Pos</th><th>Ovr</th><th>Service</th><th className="l">Status</th><th>Current</th><th>Projected</th><th>Market value</th><th>Tender</th></tr></thead>
          <tbody>
            {pending.map((p) => {
              const st = arbStatus(league, p, super2);
              const proj = st.eligible ? arbProjection(league, p, st.year) : s.minSalary;
              const plan = org.tenderPlan[p.id] ?? true;
              return (
                <tr key={p.id}>
                  <td className="l"><a href={href('player', [p.id])}>{p.first} {p.last}</a></td>
                  <td>{posLabel(p)}</td>
                  <td><Rating v={scoutedOvr(league, p)} /></td>
                  <td>{serviceLabel(p.mlServiceDays, s)}</td>
                  <td className="l">{st.eligible ? `Arb ${st.year}${super2.has(p.id) && st.year === 1 ? ' (Super Two)' : ''}` : 'Pre-arb'}</td>
                  <td>{fmtMoney(p.contract.salary)}</td>
                  <td>{fmtMoney(proj)}</td>
                  <td>{fmtMoney(marketValue(p, s))}</td>
                  <td>
                    <select value={plan ? 'y' : 'n'} onChange={(e) => { org.tenderPlan[p.id] = e.target.value === 'y'; changed(); }}>
                      <option value="y">Tender</option>
                      <option value="n">Non-tender</option>
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <h2>Arbitration cases</h2>
      <p className="muted small">
        Figures are exchanged January 9 and hearings are held February 5. The arbitrator picks whichever figure is closer to the player's value. Most cases settle before then.
      </p>
      {cases.length === 0 ? (
        <p className="muted">None.</p>
      ) : (
        <table className="data compact">
          <thead><tr><th className="l">Player</th><th>Projected</th><th>Player filed</th><th>Your figure</th><th className="l">Result</th><th /></tr></thead>
          <tbody>
            {cases.map((p) => {
              const a = p.arb!;
              const open = a.settled === null;
              return (
                <tr key={p.id}>
                  <td className="l"><a href={href('player', [p.id])}>{p.first} {p.last}</a></td>
                  <td>{fmtMoney(a.projected)}</td>
                  <td>{a.player !== null ? fmtMoney(a.player) : '-'}</td>
                  <td>
                    {open && !exchanged ? (
                      <NumInput
                        
                        step="0.05"
                        style={{ width: 80 }}
                        value={((a.team ?? roundSalary(a.projected * 0.92)) / 1e6).toFixed(2)}
                        onChange={(n) => { a.team = n * 1e6; changed(); }}
                      />
                    ) : a.team !== null ? fmtMoney(a.team) : '-'}
                  </td>
                  <td className="l">{a.settled !== null ? `${a.result}: ${fmtMoney(a.settled)}` : 'Open'}</td>
                  <td className="nowrap">
                    {open && !exchanged && (
                      <button className="btn btn-sm" onClick={() => { settleArb(league, p, a.projected, 'Avoided arbitration'); changed(); }}>
                        Settle at {fmtMoney(a.projected)}
                      </button>
                    )}
                    {open && exchanged && a.player !== null && a.team !== null && (
                      <button className="btn btn-sm" onClick={() => { settleArb(league, p, (a.player! + a.team!) / 2, 'Settled at the midpoint'); changed(); }}>
                        Settle at midpoint {fmtMoney((a.player + a.team) / 2)}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
