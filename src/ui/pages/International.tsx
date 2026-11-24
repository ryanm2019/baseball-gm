import { useState } from 'react';
import { useStore, changed, setMessage } from '../../store.ts';
import { href } from '../../router.ts';
import type { Player } from '../../core/types.ts';
import { askingRange, canOfferIfa, ifaBidders, ifaPhase, ifaWillingness, isIfa, offerIfa, poolFor, poolLeft, verbalTotal } from '../../core/intl.ts';
import { willingnessBand } from '../../core/draft.ts';
import { fmtMoney } from '../../core/contracts.ts';
import { posLabel } from '../../core/rules.ts';
import { DataTable, type Column, NumInput } from '../components.tsx';
import { PosFilterSelect, posFilterFn } from '../posFilter.tsx';

let ifaPos = 'all';
import { bt, nameCol, ratingCols } from '../fmt.tsx';
import { delegated } from '../../core/staff.ts';

export default function International() {
  const { league } = useStore();
  const [pf, setPfState] = useState(ifaPos);
  const setPf = (v: string) => { ifaPos = v; setPfState(v); };
  const [sel, setSel] = useState<number | null>(null);
  const [amt, setAmt] = useState<Record<number, number>>({});
  if (!league) return null;
  const org = league.orgs[league.userOrgId];
  const phase = ifaPhase(league);
  const pool = league.intl.pools[org.id] ?? poolFor(org.market);
  const spent = league.intl.spent[org.id] ?? 0;
  const verbal = verbalTotal(league, org.id);
  const left = poolLeft(league, org.id);
  const cls = Object.values(league.players).filter(isIfa).filter(posFilterFn(pf));
  const signed = Object.values(league.players).filter((p) => p.orgId === org.id && p.contract.bonus && p.signAge !== undefined && p.teamSince === league.season && (p.signAge <= 17 || p.level === 'AAA') && p.contract.bonus >= 10_000 && !p.draft);
  const mine = cls.filter((p) => p.ifa!.verbal?.orgId === org.id);
  const status = (p: Player) => {
    const v = p.ifa!.verbal;
    if (!v) return '';
    return v.orgId === org.id ? `Agreed with you (${fmtMoney(v.amount)})` : `Agreed with ${league.orgs[v.orgId].abbrev}`;
  };
  const cols: Column<Player>[] = [
    nameCol(league),
    { key: 'pos', label: 'Pos', value: (p) => posLabel(p) },
    { key: 'bt', label: 'B/T', value: bt },
    { key: 'country', label: 'From', left: true, value: (p) => p.country + (p.ifa?.posted ? ` (${p.ifa.posted})` : '') },
    { key: 'age', label: 'Age', value: (p) => (p.ifa?.year ?? league.season) - p.born },
    ...ratingCols(league),
    {
      key: 'ask',
      label: 'Asking (scouted)',
      title: 'What your international scouts think he wants. Better scouting gives a narrower, more accurate range.',
      value: (p) => askingRange(league, p).mid,
      render: (p) => {
        const r = askingRange(league, p);
        return r.hi <= 20_000 ? fmtMoney(r.mid) : `${fmtMoney(r.lo)}–${fmtMoney(r.hi)}`;
      },
    },
    {
      key: 'bids',
      label: 'Other clubs in',
      left: true,
      value: (p) => ifaBidders(league, p).length,
      render: (p) => <span className="small">{ifaBidders(league, p).map((o) => o.abbrev).join(', ') || '-'}</span>,
    },
    { key: 'status', label: 'Status', left: true, value: status, render: (p) => <span className={`small${p.ifa!.verbal?.orgId === org.id ? ' pos' : ''}`}>{status(p)}</span> },
    {
      key: 'neg',
      label: '',
      noSort: true,
      render: (p) => (
        <button className={`btn btn-sm${sel === p.id ? ' active' : ''}`} disabled={phase === 'closed'} onClick={() => setSel(p.id)}>
          Negotiate
        </button>
      ),
    },
  ];
  const p = sel !== null ? league.players[sel] : null;
  return (
    <>
      <h1>International Amateurs</h1>
      <p>
        Bonus pool: <b>{fmtMoney(pool)}</b> · Signed: <b>{fmtMoney(spent)}</b> · Verbal agreements: <b>{fmtMoney(verbal)}</b> · Left: <b>{fmtMoney(left)}</b>
        <span className="muted small"> (hard cap: you can't commit more than your pool)</span>
      </p>
      <p className="muted small">
        {phase === 'negotiation' && 'Negotiation window: an accepted offer is a verbal agreement that becomes a contract on signing day, January 15. Verbals can fall apart: a club offering at least 15% more can steal a player, and on negotiation day (January 1) late reports move prices. '}
        {phase === 'open' && 'The signing period is open: an accepted offer signs the player on the spot. Unsigned players lower their asks every week. '}
        {phase === 'closed' && 'The next class is revealed December 15; negotiations run until signing day, January 15. '}
        One official offer per player per week. Lowballs (under ~80% of his price) make him dig in. Competition raises the price: he wants at least what the best other club has offered. Players posted from Asian leagues who are under 25 sign here too, out of the pool, and report to AAA.
      </p>
      {delegated(league, org, 'ifa') && <p className="muted small">Your assistant GM is negotiating with your pool (Staff page to take this over).</p>}

      {p && isIfa(p) && (() => {
        const r = askingRange(league, p);
        const a = amt[p.id] ?? Math.min(left, r.mid);
        const w = ifaWillingness(league, p, a);
        const why = canOfferIfa(league, org.id, p, a);
        const last = p.ifa!.lastOffer?.[org.id];
        return (
          <div className="box">
            <h3>
              <a href={href('player', [p.id])}>{p.first} {p.last}</a> <span className="muted small">{posLabel(p)}, {p.country}{p.ifa!.posted ? ` (posted, ${p.ifa!.posted})` : ''}</span>
            </h3>
            <p className="small">
              Scouts' read on his asking price: <b>{fmtMoney(r.lo)}–{fmtMoney(r.hi)}</b>.{' '}
              {ifaBidders(league, p).length ? <>Other clubs in on him: <b>{ifaBidders(league, p).map((o) => o.abbrev).join(', ')}</b>. </> : 'No other clubs have shown interest yet. '}
              {status(p) && <b>{status(p)}. </b>}
              {last !== undefined && <span className="muted">Your last offer: {fmtMoney(p.ifa!.bids?.[org.id] ?? 0)} ({league.day - last} days ago).</span>}
            </p>
            <div className="form-row">
              <NumInput  step={0.05} min={0} style={{ width: 80 }} value={(a / 1e6).toFixed(2)} onChange={(n) => setAmt({ ...amt, [p.id]: Math.max(10_000, n * 1e6) })} /> $M{' '}
              <input type="range" min={10_000} max={Math.max(r.hi * 1.6, 50_000)} step={10_000} value={a} onChange={(e) => setAmt({ ...amt, [p.id]: Number(e.target.value) })} style={{ width: 200 }} />{' '}
              <span className="meter"><span className="meter-fill" style={{ width: `${Math.round(w * 100)}%`, background: w >= 0.65 ? '#2e8b57' : w >= 0.35 ? '#d4a017' : '#c0392b' }} /></span>{' '}
              <span className="small">{willingnessBand(w)}</span>{' '}
              <button
                className="btn btn-sm btn-primary"
                disabled={!!why}
                title={why ?? ''}
                onClick={() => {
                  const res = offerIfa(league, org.id, p, a);
                  setMessage(res.text);
                  changed();
                }}
              >
                Make offer
              </button>{' '}
              {why && <span className="muted small">{why}</span>}
            </div>
          </div>
        );
      })()}

      {mine.length > 0 && (
        <p>
          <b>Your verbal agreements:</b> {mine.map((q) => `${q.first} ${q.last} (${fmtMoney(q.ifa!.verbal!.amount)})`).join(', ')}
        </p>
      )}
      <div className="form-row" style={{ margin: '6px 0' }}>
        <PosFilterSelect value={pf} onChange={setPf} />{' '}
        <span className="muted small">Players you've made offers to (or agreed with) stay at the top.</span>
      </div>
      <DataTable cols={cols} rows={cls} rowKey={(q) => q.id} defaultSort={{ key: 'ask', desc: true }} compact pinned={(q) => q.ifa?.lastOffer?.[org.id] !== undefined || q.ifa?.verbal?.orgId === org.id} />
      {signed.length > 0 && (
        <>
          <h2>Signed</h2>
          {signed.map((q) => <div key={q.id}><a href={href('player', [q.id])}>{q.first} {q.last}</a> ({q.country}) {fmtMoney(q.contract.bonus ?? 0)}</div>)}
        </>
      )}
    </>
  );
}
