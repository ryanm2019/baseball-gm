// Contract negotiation for extensions and free agents: year-by-year salaries,
// options, opt-outs, no-trade clauses and deferred money, with a live meter.
import { useState } from 'react';
import { NumInput } from '../components.tsx';
import { useStore, changed, setMessage } from '../../store.ts';
import { href, useRoute } from '../../router.ts';
import type { ContractOption, League, Player } from '../../core/types.ts';
import { fmtMoney, roundSalary } from '../../core/contracts.ts';
import { cbtAav, describeContract, playerValue, shapeSchedule, type Structure, type Terms } from '../../core/terms.ts';
import { inExclusiveWindow, pendingFreeAgent, canOfferExt, extAsk, extRefusal, extWillingness, extYears, offerExtension, pickNtcTeams, extStart } from '../../core/extensions.ts';
import { firstContractSeason, interestLabel, makeOffer, offerScore } from '../../core/freeAgency.ts';
import { willingnessBand } from '../../core/draft.ts';
import { posLabel } from '../../core/rules.ts';
import { scoutFactor } from '../../core/ratings.ts';
import { seededNormal } from '../../core/random.ts';
import { dayShort } from '../../core/settings.ts';

type OptType = 'none' | ContractOption['type'];

interface Draft {
  years: number;
  total: number;
  shape: Structure;
  custom: number[] | null;
  opt: OptType;
  optSalary: number;
  optBuyout: number;
  vestNeed: number;
  optOut: number; // index (after year i+1), -1 none
  ntc: 'none' | 'partial' | 'full';
  ntcN: number;
  defer: number;
}

function toTerms(d: Draft, league: League, p: Player, final: boolean): Terms {
  const sched = d.custom && d.custom.length === d.years ? d.custom : shapeSchedule(d.total, d.years, d.shape);
  const t: Terms = { sched };
  if (d.opt !== 'none') {
    t.option = { type: d.opt, season: 0, salary: roundSalary(d.optSalary), buyout: d.opt === 'player' ? 0 : roundSalary(d.optBuyout) };
    if (d.opt === 'vesting') t.option.vest = { stat: p.pos === 'RP' ? 'g' : p.pos === 'SP' ? 'ip' : 'pa', need: d.vestNeed };
  }
  if (d.optOut >= 0 && d.optOut < d.years - 1) t.optOuts = [d.optOut];
  if (d.ntc === 'full') t.ntc = 'full';
  else if (d.ntc === 'partial') t.ntc = final ? pickNtcTeams(league, p, league.userOrgId, d.ntcN) : Array.from({ length: d.ntcN }, (_, i) => i);
  if (d.defer > 0) t.deferPct = d.defer;
  return t;
}

const M = (x: number) => (x / 1e6).toFixed(2);

export default function Negotiate() {
  const { league } = useStore();
  const { args } = useRoute();
  const kind = args[0] === 'fa' ? 'fa' : 'ext';
  const p = league?.players[Number(args[1])];
  const [d, setD] = useState<Draft | null>(null);
  if (!league || !p) return <p>Player not found.</p>;
  const org = league.orgs[league.userOrgId];

  // Starting point: his ask (extension) or asking price (free agent).
  const init = (): Draft => {
    if (kind === 'fa' && p.fa) {
      const mine = p.fa.offers.find((o) => o.orgId === org.id);
      return { years: mine?.years ?? p.fa.asking.years, total: (mine?.aav ?? p.fa.asking.aav) * (mine?.years ?? p.fa.asking.years), shape: 'flat', custom: mine?.terms?.sched ?? null, opt: 'none', optSalary: p.fa.asking.aav, optBuyout: p.fa.asking.aav * 0.1, vestNeed: p.pos === 'RP' ? 60 : p.pos === 'SP' ? 160 : 550, optOut: -1, ntc: 'none', ntcN: 8, defer: 0 };
    }
    const years = Math.max(2, Math.min(8, extYears(league, p, 8).findIndex((y) => y.status === 'FA') + 2 || 3));
    const ask = extAsk(league, p, years);
    const last = ask.byYear[ask.byYear.length - 1]?.fair ?? league.settings.minSalary;
    return { years, total: roundSalary(ask.total * 0.95), shape: pendingFreeAgent(league, p) ? 'flat' : 'ramp', custom: null, opt: 'none', optSalary: last, optBuyout: last * 0.08, vestNeed: p.pos === 'RP' ? 60 : p.pos === 'SP' ? 160 : 550, optOut: -1, ntc: 'none', ntcN: 8, defer: 0 };
  };
  const cur = d ?? init();
  const set = (patch: Partial<Draft>) => setD({ ...cur, ...patch });
  const terms = toTerms(cur, league, p, false);
  const start = kind === 'fa' ? firstContractSeason(league) : extStart(league, p);
  const statuses = kind === 'ext' ? extYears(league, p, cur.years) : null;

  let meter = 0;
  let meterText = '';
  let block: string | null = null;
  let askLine = '';
  if (kind === 'ext') {
    block = canOfferExt(league, p) ?? extRefusal(league, p);
    meter = extWillingness(league, p, terms);
    meterText = willingnessBand(meter);
    const ask = extAsk(league, p, cur.years).total;
    const f = scoutFactor(league, org, 'own');
    const mid = ask * Math.exp(0.08 * f * seededNormal(p.scoutSeed, org.id, 6161));
    const half = 0.05 + 0.12 * f;
    askLine = `Your scouts' read on his ask for ${cur.years} years: ${fmtMoney(mid * (1 - half))}–${fmtMoney(mid * (1 + half))}.`;
  } else if (p.fa) {
    const yrs = cur.years;
    const sc = offerScore(league, p, { orgId: org.id, years: yrs, aav: cbtAav(terms), day: league.day, terms });
    meter = Math.max(0, Math.min(1, (sc - 0.8) / 0.35));
    meterText = interestLabel(sc);
    askLine = `Asking: ${p.fa.asking.years} yr × ${fmtMoney(p.fa.asking.aav)}. Decides by ${dayShort(league.season, p.fa.decideDay)} (strong offers can speed that up). ${p.fa.offers.length} offer(s) on the table.`;
    if (p.fa.pending) block = p.fa.pending.orgId === org.id ? 'He has agreed to terms with you; the deal waits on your roster move.' : 'He has agreed to terms elsewhere.';
  } else block = 'Not a free agent';

  const sched = terms.sched;
  const tot = sched.reduce((a, b) => a + b, 0);
  const valueToHim = playerValue(terms, statuses ? statuses[statuses.length - 1].fair : (p.fa?.asking.aav ?? 0), { loyalty: p.personality.loyalty, age: start - p.born });

  const submit = () => {
    const final = toTerms(cur, league, p, true);
    if (kind === 'ext') {
      const r = offerExtension(league, p, final);
      setMessage(r.text);
    } else {
      const err = makeOffer(league, p, org.id, final.sched.length, cbtAav(final), final);
      setMessage(err ? `Offer not made: ${err}` : `Offer made to ${p.first} ${p.last}: ${final.sched.length} years, ${fmtMoney(tot)}.`);
    }
    setD(null);
    changed();
  };

  return (
    <>
      <h1>{kind === 'ext' ? 'Extension' : 'Free agent offer'}: <a href={href('player', [p.id])}>{p.first} {p.last}</a> <span className="muted small">{posLabel(p)}, age {league.season - p.born}</span></h1>
      <p className="small">Current contract: {describeContract(league, p.contract)}</p>
      {p.arb && p.arb.settled === null && kind === 'ext' && <p className="small"><b>Arbitration case pending</b> (projected {fmtMoney(p.arb.projected)}). An extension settles it: no hearing, and he'll appreciate it.</p>}
      <p className="small">{askLine}</p>
      {kind === 'fa' && p.fa && !p.fa.pending && (() => {
        const mine = p.fa.offers.find((o) => o.orgId === org.id);
        const t = p.fa.talk;
        const rivals = p.fa.offers.filter((o) => o.orgId !== org.id).map((o) => offerScore(league, p, o));
        const top = rivals.length ? Math.max(...rivals) : 0;
        const ms = mine ? offerScore(league, p, mine) : 0;
        return (
          <div className="agent-box">
            <b>His agent:</b>{' '}
            {!mine ? `No offer from you yet. ${rivals.length ? `${rivals.length} other club${rivals.length === 1 ? ' has' : 's have'} made offers.` : 'Nobody has made an offer yet.'}`
              : t && t.respondDay >= 0 ? `Reviewing your offer; you'll hear back by ${dayShort(league.season, t.respondDay)}.`
              : t?.range ? <>We're looking for a contract in the range of <b>{fmtMoney(t.range.lo)}–{fmtMoney(t.range.hi)} a year</b> over {t.range.years === 1 ? 'one year' : `about ${t.range.years} years`}.{top > ms ? ' Another club has offered more.' : ''}</>
              : top > ms ? 'Another club has offered more. Improve your offer to get back in front.' : 'Your offer leads right now.'}
            <div className="muted small">Each offer you send gets an answer in a day or three: he signs, his agent tells you the range he's looking for, or that you're not close. You'll also hear if another club tops you.</div>
          </div>
        );
      })()}
      {block && <div className="alert alert-warn">{block}</div>}

      <div className="form-row">
        <label>Years <select value={cur.years} onChange={(e) => set({ years: Number(e.target.value), custom: null })}>{Array.from({ length: 10 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></label>{' '}
        <label>Total $<NumInput  step={0.5} style={{ width: 90 }} value={M(tot)} onChange={(n) => set({ total: n * 1e6, custom: null })} />M</label>{' '}
        <label>Structure <select value={cur.shape} onChange={(e) => set({ shape: e.target.value as Structure, custom: null })}>
          <option value="flat">Flat</option><option value="front">Front-loaded</option><option value="back">Back-loaded</option><option value="ramp">Arb-style ramp (+20%/yr)</option>
        </select></label>
      </div>
      <table className="data compact" style={{ width: 'auto', minWidth: 0 }}>
        <thead><tr><th>Season</th>{statuses && <th className="l">Would be</th>}{statuses && <th>Est. value</th>}<th>Salary ($M)</th></tr></thead>
        <tbody>
          {sched.map((x, i) => (
            <tr key={i}>
              <td>{start + i}</td>
              {statuses && <td className="l">{statuses[i]?.status}</td>}
              {statuses && <td>{fmtMoney(statuses[i]?.fair ?? 0)}</td>}
              <td><NumInput  step={0.25} style={{ width: 80 }} value={M(x)} onChange={(n) => { const c = [...sched]; c[i] = roundSalary(n * 1e6); set({ custom: c }); }} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Clauses</h3>
      <div className="form-row">
        <label>Option ({start + cur.years}) <select value={cur.opt} onChange={(e) => set({ opt: e.target.value as OptType })}>
          <option value="none">None</option><option value="club">Club option</option><option value="player">Player option</option><option value="mutual">Mutual option</option><option value="vesting">Vesting option</option>
        </select></label>{' '}
        {cur.opt !== 'none' && <>
          <label>Salary $<NumInput  step={0.25} style={{ width: 70 }} value={M(cur.optSalary)} onChange={(n) => set({ optSalary: n * 1e6 })} />M</label>{' '}
          {cur.opt !== 'player' && <label>Buyout $<NumInput  step={0.25} style={{ width: 70 }} value={M(cur.optBuyout)} onChange={(n) => set({ optBuyout: n * 1e6 })} />M</label>}{' '}
          {cur.opt === 'vesting' && <label>Vests at <NumInput  style={{ width: 60 }} value={cur.vestNeed} onChange={(n) => set({ vestNeed: n })} /> {p.pos === 'RP' ? 'appearances' : p.pos === 'SP' ? 'innings' : 'plate appearances'} in {start + cur.years - 1}</label>}
        </>}
      </div>
      <div className="form-row">
        <label>Opt-out <select value={cur.optOut} onChange={(e) => set({ optOut: Number(e.target.value) })}>
          <option value={-1}>None</option>
          {Array.from({ length: Math.max(0, cur.years - 1) }, (_, i) => <option key={i} value={i}>After {start + i}</option>)}
        </select></label>{' '}
        <label>No-trade <select value={cur.ntc} onChange={(e) => set({ ntc: e.target.value as Draft['ntc'] })}>
          <option value="none">None</option><option value="partial">Partial (he picks teams)</option><option value="full">Full</option>
        </select></label>{' '}
        {cur.ntc === 'partial' && <label><NumInput  min={1} max={29} style={{ width: 50 }} value={cur.ntcN} onChange={(n) => set({ ntcN: Math.max(1, Math.min(29, n)) })} /> teams</label>}{' '}
        <label>Deferred <select value={cur.defer} onChange={(e) => set({ defer: Number(e.target.value) })}>
          {[0, 0.1, 0.2, 0.3, 0.4, 0.5].map((x) => <option key={x} value={x}>{Math.round(x * 100)}%</option>)}
        </select></label>
        <span className="muted small"> (paid over 10 years after the deal ends)</span>
      </div>

      <p>
        Guaranteed: <b>{fmtMoney(tot)}</b> · CBT AAV: <b>{fmtMoney(cbtAav(terms))}</b>{terms.deferPct ? ` (deferrals lower it)` : ''} · Value to him: <b>{fmtMoney(valueToHim)}</b>
      </p>
      <div className="form-row">
        <span className="meter"><span className="meter-fill" style={{ width: `${Math.round(meter * 100)}%`, background: meter >= 0.65 ? '#2e8b57' : meter >= 0.35 ? '#d4a017' : '#c0392b' }} /></span>{' '}
        <b>{meterText}</b>{' '}
        <button className="btn btn-primary" disabled={!!block} onClick={submit}>{kind === 'ext' ? 'Make offer' : 'Submit offer'}</button>
      </div>
      <p className="muted small">
        {kind === 'ext'
          ? (inExclusiveWindow(league) && pendingFreeAgent(league, p) ? 'Exclusive window: he\'s about to become a free agent, and most players want to test the market, so even a fair offer usually falls short. Loyal and longtime players are likelier to stay. One offer a day. ' : 'One offer a week. ') + 'Each year is valued by what he would otherwise earn (pre-arb, arbitration or free agency); younger players give up more for security. Player options, opt-outs and no-trade clauses are worth money to him; club and mutual options aren\'t. Lowballs (under ~80% of his ask) make him dig in.'
          : 'Free agents compare all offers (AI clubs use options, opt-outs and no-trade clauses too). Clauses and deferrals change what your offer is worth to him.'}
      </p>
      <p className="muted small">
        <b>How the clauses work.</b> <b>Full no-trade:</b> he must approve any trade; he usually agrees to go to a contender, rarely to a rebuilding club, and an unhappy player waives it more readily. It's worth about 3% of the deal to him (more if he's loyal). <b>Partial no-trade:</b> he lists teams he can block. <b>10-and-5:</b> 10 years of service with 5 on one club gives the same right as a full no-trade. <b>Opt-out:</b> after that season he can void the rest and re-enter free agency (worth more to younger players). <b>Player option:</b> his choice to add a year; <b>club option:</b> yours; <b>vesting:</b> guaranteed if he hits the playing-time mark. <b>Deferrals:</b> part of each year's salary is paid over 10 years after the deal ends; it lowers your luxury tax number but is worth less to him.
      </p>
    </>
  );
}
