import { useState } from 'react';
import { useStore, changed, setMessage } from '../../store.ts';
import { go, href, useRoute } from '../../router.ts';
import type { Level, Player } from '../../core/types.ts';
import { MINOR_LEVELS } from '../../core/types.ts';
import { signFreeAgent, posLabel } from '../../core/rules.ts';
import { fmtMoney, serviceLabel, serviceYears } from '../../core/contracts.ts';
import { interestLabel, isFreeAgent, isMinorFA, makeOffer, offerScore, withdrawOffer, firstContractSeason } from '../../core/freeAgency.ts';
import { tradePlayerCols } from '../tradeCols.tsx';
import { DataTable, type Column, NumInput } from '../components.tsx';
import { bt, nameCol, ratingCols } from '../fmt.tsx';
import { dayShort } from '../../core/settings.ts';
import { fortyMan } from '../../core/util.ts';
import { offseasonCalendar } from '../../core/offseason.ts';
import { isPitcher } from '../../core/ratings.ts';

// Position filter (kept while you browse other pages).
const POS_FILTERS: Record<string, (p: Player) => boolean> = {
  all: () => true,
  hitters: (p) => !isPitcher(p),
  C: (p) => p.pos === 'C', '1B': (p) => p.pos === '1B', '2B': (p) => p.pos === '2B', '3B': (p) => p.pos === '3B', SS: (p) => p.pos === 'SS',
  IF: (p) => ['1B', '2B', '3B', 'SS'].includes(p.pos),
  LF: (p) => p.pos === 'LF', CF: (p) => p.pos === 'CF', RF: (p) => p.pos === 'RF',
  OF: (p) => ['LF', 'CF', 'RF'].includes(p.pos),
  DH: (p) => p.pos === 'DH',
  pitchers: isPitcher, SP: (p) => p.pos === 'SP', RP: (p) => p.pos === 'RP',
};
const POS_LABELS: [string, string][] = [['all', 'All positions'], ['hitters', 'Hitters'], ['C', 'C'], ['1B', '1B'], ['2B', '2B'], ['3B', '3B'], ['SS', 'SS'], ['IF', 'Infield'], ['LF', 'LF'], ['CF', 'CF'], ['RF', 'RF'], ['OF', 'Outfield'], ['DH', 'DH'], ['pitchers', 'Pitchers'], ['SP', 'SP'], ['RP', 'RP']];
let posFilter = 'all';
let showUpcoming = true;

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
      $<NumInput  step="0.25" style={{ width: 70 }} value={aav} onChange={(_n, raw) => setAav(raw)} />M{' '}
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
      <a className="small" href={href('negotiate', ['fa', p.id])} title="Year-by-year salaries, options, opt-outs, no-trade, deferrals">Full terms</a>{' '}
      <span className="small muted">{interestLabel(preview)}</span>
    </span>
  );
}

export default function FreeAgents() {
  const { league } = useStore();
  const route = useRoute();
  const [pf, setPfState] = useState(posFilter);
  const setPf = (v: string) => { posFilter = v; setPfState(v); };
  const [up, setUpState] = useState(showUpcoming);
  const setUp = (v: boolean) => { showUpcoming = v; setUpState(v); };
  if (!league) return null;
  const tab = route.query.tab ?? 'ml';
  const fas = Object.values(league.players).filter(isFreeAgent).filter(POS_FILTERS[pf] ?? (() => true));
  // Players weighing a qualifying offer: they hit the market if they turn it down.
  const qoDay = offseasonCalendar(league).find((e) => e.key === 'qo-response')?.day;
  const qoPending = league.phase === 'offseason' ? Object.values(league.players).filter((p) => p.qoPending && p.orgId !== null && (POS_FILTERS[pf] ?? (() => true))(p)) : [];
  // The class that's coming: players whose contracts run out this season and who
  // will be free agents (or are deciding on a qualifying offer). Listed with the
  // free agents so sorting shows the whole class; they can't be signed yet.
  const cal = offseasonCalendar(league);
  const faOpenDay = cal.find((e) => e.key === 'fa-open')?.day;
  const upcoming = up ? Object.values(league.players).filter((p) => p.orgId !== null && !p.retired && (POS_FILTERS[pf] ?? (() => true))(p) && (
    (league.phase === 'offseason' && !!p.qoPending) ||
    (p.contract.type === 'ML' && p.contract.exp === league.season && !(p.contract.option && p.contract.option.season > league.season && league.phase !== 'offseason') && !p.qoPending && !(league.phase === 'offseason' && league.events.includes('fa-open')) && (serviceYears(p.mlServiceDays, league.settings) >= 6 || (league.phase !== 'offseason' && serviceYears(p.mlServiceDays, league.settings) >= 5)) && p.level === 'MLB')
  )) : [];
  const upLabel = (p: Player) => p.qoPending ? `Deciding on a qualifying offer${qoDay !== undefined ? ` (answers ${dayShort(league.season, qoDay)})` : ''}` : league.phase === 'offseason' && faOpenDay !== undefined ? `Free agent ${dayShort(league.season, faOpenDay)}` : 'Free agent after the season';
  const ml = [...fas.filter((p) => p.fa && !isMinorFA(league, p)), ...upcoming];
  const milb = fas.filter((p) => isMinorFA(league, p));
  const mineOffers = ml.filter((p) => p.fa?.offers.some((o) => o.orgId === league.userOrgId));
  const start = firstContractSeason(league);

  const base: Column<Player>[] = [
    nameCol(league),
    { key: 'pos', label: 'Pos', value: (p) => posLabel(p) },
    { key: 'bt', label: 'B/T', value: bt },
    { key: 'age', label: 'Age', title: `Age in ${start}`, value: (p) => start - p.born },
    ...ratingCols(league),
    // This season's numbers (all levels) right beside the ratings.
    ...tradePlayerCols(league).filter((c) => ['n', 'wrc', 'fipm', 'line'].includes(c.key)),
  ];
  const mlCols: Column<Player>[] = [
    ...base,
    { key: 'team', label: 'Team', title: 'Upcoming free agents: the club he is with now', value: (p) => (p.orgId !== null ? league.orgs[p.orgId].abbrev : ''), render: (p) => (p.orgId !== null ? <span className="muted">{league.orgs[p.orgId].abbrev}</span> : '') },
    { key: 'ask', label: 'Asking', value: (p) => p.fa?.asking.aav ?? 0, render: (p) => (p.fa ? `${p.fa.asking.years} yr × ${fmtMoney(p.fa.asking.aav)}` : <span className="muted small">{upLabel(p)}</span>) },
    { key: 'offers', label: 'Offers', value: (p) => p.fa?.offers.length ?? -1, render: (p) => (p.fa ? p.fa.offers.length : '') },
    { key: 'dec', label: 'Decides', value: (p) => p.fa?.decideDay ?? 9999, render: (p) => (p.fa ? dayShort(league.season, p.fa.decideDay) : '') },
    { key: 'posted', label: 'Posted', title: 'Posted by an Asian club: must sign by the deadline or he goes back. The signing club pays his old club a posting fee (20% of the first $25M, 17.5% of the next $25M, 15% beyond).', value: (p) => p.fa?.posted?.deadline ?? 0, render: (p) => (p.fa?.posted ? `${p.fa.posted.from}, sign by ${dayShort(league.season, p.fa.posted.deadline)}` : '') },
    { key: 'qo', label: 'QO', title: 'Declined a qualifying offer: signing him costs your second-round pick', value: (p) => (p.fa?.qo ? 1 : 0), render: (p) => (p.fa?.qo ? 'Yes' : p.qoPending ? 'Pending' : '') },
    { key: 'offer', label: 'Your offer', noSort: true, render: (p) => (p.fa ? <OfferCell p={p} /> : <span className="muted small">Can't sign yet</span>) },
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
        <button className={`btn btn-sm${tab === 'ml' ? ' active' : ''}`} onClick={() => go('free-agents', [], { tab: 'ml' })}>Major league ({ml.length - upcoming.length}{upcoming.length ? ` + ${upcoming.length} upcoming` : ''})</button>
        <button className={`btn btn-sm${tab === 'milb' ? ' active' : ''}`} onClick={() => go('free-agents', [], { tab: 'milb' })}>Minor league ({milb.length})</button>
      </div>
      <div className="form-row" style={{ margin: '6px 0' }}>
        <select value={pf} onChange={(e) => setPf(e.target.value)}>
          {POS_LABELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>{' '}
        {tab === 'ml' && (
          <label className="small" title="Players whose contracts run out this season, and anyone deciding on a qualifying offer">
            <input type="checkbox" checked={up} onChange={(e) => setUp(e.target.checked)} /> Include upcoming free agents ({upcoming.length})
          </label>
        )}
      </div>
      {tab === 'ml' ? (
        <>
          {qoPending.length > 0 && (
            <div className="alert alert-info small">
              <b>Deciding on qualifying offers{qoDay !== undefined ? ` (they answer ${dayShort(league.season, qoDay)})` : ''}:</b>{' '}
              {qoPending.sort((a, b) => b.contract.salary - a.contract.salary).map((p, i) => (
                <span key={p.id}>{i ? ' · ' : ''}<a href={href('player', [p.id])}>{p.first} {p.last}</a> <span className="muted">{posLabel(p)}, {league.orgs[p.orgId!].abbrev}</span></span>
              ))}
              . Anyone who turns it down becomes a free agent; signing him costs a draft pick.
            </div>
          )}
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
