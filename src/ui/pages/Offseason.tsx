import { useStore, changed } from '../../store.ts';
import { href } from '../../router.ts';
import { dayLabel, dayShort } from '../../core/settings.ts';
import { nextEvent, offseasonCalendar, pendingOptions, qoAmount, qoEligible } from '../../core/offseason.ts';
import { fmtMoney, marketValue, serviceLabel } from '../../core/contracts.ts';
import { posLabel } from '../../core/rules.ts';
import { delegated } from '../../core/staff.ts';
import { activeAt, activeLimit, fortyMan } from '../../core/util.ts';
import { Rating } from '../components.tsx';
import { scoutedOvr } from '../../core/ratings.ts';

export default function Offseason() {
  const { league } = useStore();
  if (!league) return null;
  const org = league.orgs[league.userOrgId];
  if (league.phase === 'regular' || league.phase === 'playoffs') {
    return (
      <>
        <h1>Offseason</h1>
        <p>The offseason starts after the World Series. The amateur draft is held in July at the All-Star break: see <a href={href('draft')}>Draft</a>.</p>
      </>
    );
  }
  if (league.phase === 'preseason') {
    const mlb = activeAt(league, org.id, 'MLB').length;
    return (
      <>
        <h1>Spring Training {league.season}</h1>
        <p>Opening Day is {dayLabel(league.season, 0)}.</p>
        <p>
          MLB roster: <b>{mlb}</b> (must be {activeLimit(league)} by Opening Day{delegated(league, org, 'roster') ? '; your assistant GM will cut it down' : ''}) · 40-man: <b>{fortyMan(league, org.id).length}</b>/{league.settings.fortyMax}
        </p>
        <p className="muted">Free agents are still signing. <a href={href('free-agents')}>Free agents</a> · <a href={href('roster')}>Roster</a></p>
      </>
    );
  }
  const cal = offseasonCalendar(league);
  const next = nextEvent(league);
  const opts = pendingOptions(league, org.id).filter((p) => p.contract.option?.type === 'club');
  const playerOpts = pendingOptions(league, org.id).filter((p) => p.contract.option?.type === 'player');
  const qos = qoEligible(league, org.id);
  const qo = qoAmount(league);
  const optionsDone = league.events.includes('options');
  const link: Record<string, string> = { 'fa-open': 'free-agents', 'r5-protect': 'rule5', tender: 'tenders', 'r5-draft': 'rule5', 'ifa-class': 'international', 'arb-exchange': 'tenders', 'ifa-open': 'international', 'arb-hearings': 'tenders', 'qo-response': 'free-agents' };
  return (
    <>
      <h1>Offseason</h1>
      <p>Today is <b>{dayLabel(league.season, league.day)}</b>.{next && <> Next: <b>{next.label}</b> on {dayShort(league.season, next.day)}.</>}</p>
      <table className="data compact" style={{ minWidth: 0 }}>
        <thead><tr><th className="l">Date</th><th className="l">Event</th><th className="l">Status</th><th className="l">Handled by</th></tr></thead>
        <tbody>
          {cal.map((e) => {
            const done = league.events.includes(e.key);
            return (
              <tr key={e.key} className={next?.key === e.key ? 'user' : ''}>
                <td className="l">{dayShort(league.season, e.day)}</td>
                <td className="l">{link[e.key] ? <a href={href(link[e.key])}>{e.label}</a> : e.label}</td>
                <td className="l">{done ? 'Done' : next?.key === e.key ? 'Next' : ''}</td>
                <td className="l">{e.decision ? (delegated(league, org, e.decision.duty) ? 'Assistant GM' : 'You') : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h2>Club options</h2>
      {opts.length === 0 && <p className="muted">None.</p>}
      {opts.map((p) => {
        const o = p.contract.option!;
        const plan = org.optionPlan[p.id];
        return (
          <div key={p.id} className="form-row">
            <a href={href('player', [p.id])}>{p.first} {p.last}</a> {posLabel(p)} <Rating v={scoutedOvr(league, p)} /> · {o.season} option {fmtMoney(o.salary)}, buyout {fmtMoney(o.buyout)} · market value about {fmtMoney(marketValue(p, league.settings))}
            {optionsDone ? (
              <span className="muted">decided</span>
            ) : (
              <select value={plan === undefined ? '' : plan ? 'y' : 'n'} onChange={(e) => { org.optionPlan[p.id] = e.target.value === 'y'; changed(); }}>
                <option value="" disabled>Choose…</option>
                <option value="y">Exercise</option>
                <option value="n">Decline (pay buyout)</option>
              </select>
            )}
          </div>
        );
      })}
      {playerOpts.length > 0 && <p className="muted small">Player options (the player decides): {playerOpts.map((p) => `${p.first} ${p.last}`).join(', ')}</p>}

      <h2>Qualifying offers ({fmtMoney(qo)})</h2>
      <p className="muted small">One year at the average of the top 125 salaries. If he declines and signs elsewhere, you get a compensation pick after round 2 and the signing team loses its second-round pick.</p>
      {qos.length === 0 && <p className="muted">No eligible players.</p>}
      {qos.map((p) => (
        <div key={p.id} className="form-row">
          <label>
            <input type="checkbox" disabled={optionsDone} checked={!!org.qoPlan[p.id]} onChange={(e) => { org.qoPlan[p.id] = e.target.checked; changed(); }} />{' '}
            <a href={href('player', [p.id])}>{p.first} {p.last}</a> {posLabel(p)} <Rating v={scoutedOvr(league, p)} /> · service {serviceLabel(p.mlServiceDays, league.settings)} · market value about {fmtMoney(marketValue(p, league.settings))}
          </label>
        </div>
      ))}
      {delegated(league, org, 'options') && <p className="muted small">Your assistant GM is making these decisions (see Staff).</p>}
    </>
  );
}
