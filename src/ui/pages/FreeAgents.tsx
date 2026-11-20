import { useState } from 'react';
import { useStore, changed, setMessage } from '../../store.ts';
import { go, useRoute } from '../../router.ts';
import type { Level, Player } from '../../core/types.ts';
import { MINOR_LEVELS } from '../../core/types.ts';
import { signFreeAgent, posLabel } from '../../core/rules.ts';
import { fmtMoney, serviceLabel } from '../../core/contracts.ts';
import { interestLabel, isFreeAgent, isMinorFA, makeOffer, offerScore, withdrawOffer, firstContractSeason } from '../../core/freeAgency.ts';
import { DataTable, type Column } from '../components.tsx';
import { bt, nameCol, ratingCols } from '../fmt.tsx';
import { dayShort } from '../../core/settings.ts';
import { fortyMan } from '../../core/util.ts';

function MilbCell({ p }: { p: Player }) {
  const { league } = useStore();
  const [lvl, setLvl] = useState<Level>('AAA');
  if (!league) return null;
  return (
    <span className="nowrap">
      <select value={lvl} onChange={(e) => setLvl(e.target.value as Level)}>
        {MINOR_LEVELS.map((l) => <option key={l}>{l}</option>)}
      </select>{' '}
      <button
        className="btn btn-sm"
        onClick={() => {
          const err = signFreeAgent(league, p, league.userOrgId, lvl, false);
          setMessage(err ? `Can't sign ${p.first} ${p.last}: ${err}` : null);
          changed();
        }}
      >
        Sign MiLB deal
      </button>
    </span>
  );
}

function OfferCell({ p }: { p: Player }) {
  const { league } = useStore();
  const mine = p.fa?.offers.find((o) => o.orgId === league?.userOrgId);
  const [years, setYears] = useState(mine?.years ?? p.fa?.asking.years ?? 1);
  const [aav, setAav] = useState(((mine?.aav ?? p.fa?.asking.aav ?? 0) / 1e6).toFixed(2));
  if (!league || !p.fa) return null;
  const preview = offerScore(league, p, { orgId: league.userOrgId, years, aav: Number(aav) * 1e6, day: league.day });
  return (
    <span className="nowrap">
      <select value={years} onChange={(e) => setYears(Number(e.target.value))}>
        {Array.from({ length: 10 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1} yr</option>)}
      </select>{' '}
      $<input type="number" step="0.25" style={{ width: 70 }} value={aav} onChange={(e) => setAav(e.target.value)} />M{' '}
      <button
        className="btn btn-sm"
        onClick={() => {
          const err = makeOffer(league, p, league.userOrgId, years, Number(aav) * 1e6);
          setMessage(err ? `Offer not made: ${err}` : null);
          changed();
        }}
      >
        {mine ? 'Update' : 'Offer'}
      </button>{' '}
      {mine && <button className="btn btn-sm" onClick={() => { withdrawOffer(p, league.userOrgId); changed(); }}>Withdraw</button>}{' '}
      <span className="small muted">{interestLabel(preview)}</span>
    </span>
  );
}

export default function FreeAgents() {
  const { league } = useStore();
  const route = useRoute();
  if (!league) return null;
  const tab = route.query.tab ?? 'ml';
  const fas = Object.values(league.players).filter(isFreeAgent);
  const ml = fas.filter((p) => p.fa && !isMinorFA(league, p));
  const milb = fas.filter((p) => isMinorFA(league, p));
  const mineOffers = ml.filter((p) => p.fa!.offers.some((o) => o.orgId === league.userOrgId));
  const start = firstContractSeason(league);

  const base: Column<Player>[] = [
    nameCol(league),
    { key: 'pos', label: 'Pos', value: (p) => posLabel(p) },
    { key: 'bt', label: 'B/T', value: bt },
    { key: 'age', label: 'Age', title: `Age in ${start}`, value: (p) => start - p.born },
    ...ratingCols(league),
  ];
  const mlCols: Column<Player>[] = [
    ...base,
    { key: 'ask', label: 'Asking', value: (p) => p.fa!.asking.aav, render: (p) => `${p.fa!.asking.years} yr × ${fmtMoney(p.fa!.asking.aav)}` },
    { key: 'offers', label: 'Offers', value: (p) => p.fa!.offers.length },
    { key: 'dec', label: 'Decides', value: (p) => p.fa!.decideDay, render: (p) => dayShort(league.season, p.fa!.decideDay) },
    { key: 'qo', label: 'QO', title: 'Declined a qualifying offer: signing him costs your second-round pick', value: (p) => (p.fa!.qo ? 1 : 0), render: (p) => (p.fa!.qo ? 'Yes' : '') },
    { key: 'offer', label: 'Your offer', noSort: true, render: (p) => <OfferCell p={p} /> },
  ];
  const milbCols: Column<Player>[] = [
    ...base,
    { key: 'svc', label: 'Svc', value: (p) => p.mlServiceDays, render: (p) => serviceLabel(p.mlServiceDays, league.settings) },
    { key: 'sign', label: '', noSort: true, render: (p) => <MilbCell p={p} /> },
  ];

  return (
    <>
      <h1>Free Agents</h1>
      <div className="btn-group tabs">
        <button className={`btn btn-sm${tab === 'ml' ? ' active' : ''}`} onClick={() => go('free-agents', [], { tab: 'ml' })}>Major league ({ml.length})</button>
        <button className={`btn btn-sm${tab === 'milb' ? ' active' : ''}`} onClick={() => go('free-agents', [], { tab: 'milb' })}>Minor league ({milb.length})</button>
      </div>
      {tab === 'ml' ? (
        <>
          <p className="muted small">
            Make an offer and the player weighs it against everyone else's when he decides: money, years, how good the team is and, for his old club, loyalty. "Interest" previews how your offer stacks up against what he's asking. Contracts start in {start}. You need an open 40-man spot when he signs ({fortyMan(league, league.userOrgId).length}/{league.settings.fortyMax} now).
          </p>
          {mineOffers.length > 0 && (
            <p>
              Your open offers:{' '}
              {mineOffers.map((p) => {
                const o = p.fa!.offers.find((x) => x.orgId === league.userOrgId)!;
                return <span key={p.id} style={{ marginRight: 14 }}>{p.first} {p.last} ({o.years} × {fmtMoney(o.aav)})</span>;
              })}
            </p>
          )}
          <DataTable cols={mlCols} rows={ml} rowKey={(p) => p.id} defaultSort={{ key: 'ovr', desc: true }} compact />
        </>
      ) : (
        <>
          <p className="muted small">Minor league deals sign immediately and go to the affiliate you pick.</p>
          <DataTable cols={milbCols} rows={milb} rowKey={(p) => p.id} defaultSort={{ key: 'ovr', desc: true }} compact />
        </>
      )}
    </>
  );
}
