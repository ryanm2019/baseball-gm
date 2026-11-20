// Contract negotiation for extensions and free agents: year-by-year salaries,
// options, opt-outs, no-trade clauses and deferred money, with a live meter.
import { useState } from 'react';
import { useStore, changed, setMessage } from '../../store.ts';
import { href, useRoute } from '../../router.ts';
import type { ContractOption, League, Player } from '../../core/types.ts';
import { fmtMoney, roundSalary } from '../../core/contracts.ts';
import { cbtAav, describeContract, playerValue, shapeSchedule, type Structure, type Terms } from '../../core/terms.ts';
import { canOfferExt, extAsk, extRefusal, extWillingness, extYears, offerExtension, pickNtcTeams, extStart } from '../../core/extensions.ts';
import { firstContractSeason, interestLabel, makeOffer, offerScore } from '../../core/freeAgency.ts';
import { willingnessBand } from '../../core/draft.ts';
import { posLabel } from '../../core/rules.ts';
import { scoutFactor } from '../../core/ratings.ts';
import { seededNormal } from '../../core/random.ts';
import { fortyMan } from '../../core/util.ts';

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
    return { years, total: roundSalary(ask.total * 0.95), shape: 'ramp', custom: null, opt: 'none', optSalary: last, optBuyout: last * 0.08, vestNeed: p.pos === 'RP' ? 60 : p.pos === 'SP' ? 160 : 550, optOut: -1, ntc: 'none', ntcN: 8, defer: 0 };
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
    askLine = `Asking: ${p.fa.asking.years} yr × ${fmtMoney(p.fa.asking.aav)}. Decides around day ${p.fa.decideDay}. ${p.fa.offers.length} offer(s) on the table.`;
    if (fortyMan(league, org.id).length >= league.settings.fortyMax) block = `Your 40-man roster is full (${league.settings.fortyMax}). Clear a spot before making an offer: he has to go on it when he signs.`;
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
      {block && <div className="alert alert-warn">{block}</div>}

      <div className="form-row">
        <label>Years <select value={cur.years} onChange={(e) => set({ years: Number(e.target.value), custom: null })}>{Array.from({ length: 10 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></label>{' '}
        <label>Total $<input type="number" step={0.5} style={{ width: 90 }} value={M(tot)} onChange={(e) => set({ total: Number(e.target.value) * 1e6, custom: null })} />M</label>{' '}
        <label>Structure <select value={cur.shape} onChange={(e) => set({ shape: e.target.value as Structure, custom: null })}>
          <option value="flat">Flat</option><option value="front">Front-loaded</option><option value="back">Back-loaded</option><option value="ramp">Arb-style ramp (+20%/yr)</option>
        </select></label>
      </div>
      <table className="data compact" style={{ width: 'auto' }}>
        <thead><tr><th>Season</th>{statuses && <th className="l">Would be</th>}{statuses && <th>Est. value</th>}<th>Salary ($M)</th></tr></thead>
        <tbody>
          {sched.map((x, i) => (
            <tr key={i}>
              <td>{start + i}</td>
              {statuses && <td className="l">{statuses[i]?.status}</td>}
              {statuses && <td>{fmtMoney(statuses[i]?.fair ?? 0)}</td>}
              <td><input type="number" step={0.25} style={{ width: 80 }} value={M(x)} onChange={(e) => { const c = [...sched]; c[i] = roundSalary(Number(e.target.value) * 1e6); set({ custom: c }); }} /></td>
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
          <label>Salary $<input type="number" step={0.25} style={{ width: 70 }} value={M(cur.optSalary)} onChange={(e) => set({ optSalary: Number(e.target.value) * 1e6 })} />M</label>{' '}
          {cur.opt !== 'player' && <label>Buyout $<input type="number" step={0.25} style={{ width: 70 }} value={M(cur.optBuyout)} onChange={(e) => set({ optBuyout: Number(e.target.value) * 1e6 })} />M</label>}{' '}
          {cur.opt === 'vesting' && <label>Vests at <input type="number" style={{ width: 60 }} value={cur.vestNeed} onChange={(e) => set({ vestNeed: Number(e.target.value) })} /> {p.pos === 'RP' ? 'appearances' : p.pos === 'SP' ? 'innings' : 'plate appearances'} in {start + cur.years - 1}</label>}
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
        {cur.ntc === 'partial' && <label><input type="number" min={1} max={29} style={{ width: 50 }} value={cur.ntcN} onChange={(e) => set({ ntcN: Math.max(1, Math.min(29, Number(e.target.value))) })} /> teams</label>}{' '}
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
          ? 'One offer a week. Each year is valued by what he would otherwise earn (pre-arb, arbitration or free agency); younger players give up more for security. Player options, opt-outs and no-trade clauses are worth money to him; club and mutual options aren\'t. Lowballs (under ~80% of his ask) make him dig in.'
          : 'Free agents compare all offers when they decide. Clauses and deferrals change what your offer is worth to him.'}
      </p>
    </>
  );
}
