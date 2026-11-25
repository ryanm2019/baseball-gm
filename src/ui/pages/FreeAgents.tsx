import { useState } from 'react';
import { useStore, changed, setMessage } from '../../store.ts';
import { go, href, useRoute } from '../../router.ts';
import type { Level, Player } from '../../core/types.ts';
import { MINOR_LEVELS } from '../../core/types.ts';
import { posLabel } from '../../core/rules.ts';
import { fmtMoney, serviceLabel, serviceYears } from '../../core/contracts.ts';
import { finalizePending, interestLabel, isFreeAgent, isMinorFA, offerScore, pendingBlock, withdrawOffer, firstContractSeason } from '../../core/freeAgency.ts';
import { tradePlayerCols } from '../tradeCols.tsx';
import { DataTable, type Column } from '../components.tsx';
import { bt, nameCol, ratingCols } from '../fmt.tsx';
import { dayShort } from '../../core/settings.ts';
import { fortyMan } from '../../core/util.ts';
import { faStage, offseasonCalendar } from '../../core/offseason.ts';

import { POS_FILTERS, PosFilterSelect } from '../posFilter.tsx';
import { delegated } from '../../core/staff.ts';
import { milbDecideDay, milbOffers, offerMilb, withdrawMilb } from '../../core/milbFa.ts';

// Position filter (kept while you browse other pages).
let posFilter = 'all';
let showUpcoming = true;

function MilbCell({ p }: { p: Player }) {
  const { league } = useStore();
  const [lvl, setLvl] = useState<Level>('AAA');
  const [invite, setInvite] = useState(false);
  if (!league) return null;
  const mine = milbOffers(p).find((o) => o.orgId === league.userOrgId);
  const rivals = milbOffers(p).filter((o) => o.orgId !== league.userOrgId).length;
  const dec = milbDecideDay(p);
  if (mine) {
    return (
      <span className="nowrap small">
        Your offer: <b>{mine.level}{mine.invite ? ' + camp invite' : ''}</b> · {rivals ? `${rivals} other club${rivals === 1 ? '' : 's'}` : 'no other bids yet'}{dec !== undefined ? ` · decides ${dayShort(league.season, dec)}` : ''}{' '}
        <button className="btn btn-sm" onClick={() => { withdrawMilb(p, league.userOrgId); changed(); }}>Withdraw</button>
      </span>
    );
  }
  return (
    <span className="nowrap">
      <select value={lvl} onChange={(e) => setLvl(e.target.value as Level)}>
        {MINOR_LEVELS.map((l) => <option key={l}>{l}</option>)}
      </select>{' '}
      <label className="small" title="An invite to big league spring training: veterans like it"><input type="checkbox" checked={invite} onChange={(e) => setInvite(e.target.checked)} /> Camp invite</label>{' '}
      <button
        className="btn btn-sm"
        title={dec !== undefined ? `Other clubs are bidding; he decides ${dayShort(league.season, dec)}` : 'Starts a short bidding window: he decides in a few days'}
        onClick={() => {
          const err = offerMilb(league, league.userOrgId, p, lvl, invite);
          setMessage(err ? `Can't offer ${p.first} ${p.last}: ${err}` : `Offer made to ${p.first} ${p.last}. He decides ${dayShort(league.season, milbDecideDay(p)!)}; other clubs may bid too.`);
          changed();
        }}
      >
        Offer MiLB deal
      </button>
      {rivals > 0 && <span className="muted small"> {rivals} club{rivals === 1 ? '' : 's'} bidding</span>}
    </span>
  );
}

function OfferCell({ p }: { p: Player }) {
  const { league } = useStore();
  if (!league || !p.fa) return null;
  if (p.fa.pending) return p.fa.pending.orgId === league.userOrgId ? <b className="pos small">Agreed with you: waiting on a roster move</b> : <span className="muted small">Agreed elsewhere</span>;
  const mine = p.fa.offers.find((o) => o.orgId === league.userOrgId);
  // Every bid goes through the contract builder: year-by-year salary, options,
  // opt-outs, no-trade and deferrals, with his interest shown as you build it.
  return (
    <span className="nowrap">
      <a className={`btn btn-sm${mine ? '' : ' btn-primary'}`} href={href('negotiate', ['fa', p.id])}>{mine ? 'Revise offer' : 'Make offer'}</a>{' '}
      {mine && <span className="small">{mine.years} yr × {fmtMoney(mine.aav)} <span className="muted">· {interestLabel(offerScore(league, p, mine))}</span></span>}{' '}
      {mine && <button className="btn btn-sm" onClick={() => { withdrawOffer(p, league.userOrgId, league); changed(); }}>Withdraw</button>}
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
  const mineOffers = Object.values(league.players).filter((p) => isFreeAgent(p) && p.fa?.offers.some((o) => o.orgId === league.userOrgId));
  // How your bids turned out (signed with you, or chose someone else), this market.
  const marketSeason = league.phase === 'offseason' ? league.season : league.season - 1;
  const bidResults = (league.inbox ?? []).filter((m) => m.from === 'Front office' && / signed with /.test(m.subject) && (m.season === league.season || m.season === marketSeason)).slice(-12).reverse();
  const yourOffer = (p: Player) => p.fa!.offers.find((o) => o.orgId === league.userOrgId)!;
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
  const bidCols: Column<Player>[] = [
    nameCol(league),
    { key: 'pos', label: 'Pos', value: (p) => posLabel(p) },
    { key: 'age', label: 'Age', title: `Age in ${start}`, value: (p) => start - p.born },
    ...ratingCols(league),
    { key: 'yours', label: 'Your offer', value: (p) => yourOffer(p).aav, render: (p) => `${yourOffer(p).years} yr × ${fmtMoney(yourOffer(p).aav)}` },
    { key: 'ask', label: 'Asking', value: (p) => p.fa!.asking.aav, render: (p) => `${p.fa!.asking.years} yr × ${fmtMoney(p.fa!.asking.aav)}` },
    { key: 'interest', label: 'His interest', title: 'How your offer stacks up against what he wants (money, years, your club)', value: (p) => offerScore(league, p, yourOffer(p)), render: (p) => interestLabel(offerScore(league, p, yourOffer(p))) },
    { key: 'rivals', label: 'Other offers', value: (p) => p.fa!.offers.length - 1 },
    { key: 'talks', label: 'Talks', title: "Where things stand with his agent", noSort: true, render: (p) => {
      const t = p.fa!.talk;
      if (p.fa!.pending) return '';
      if (t && t.respondDay >= 0) return <span className="muted">Reply by {dayShort(league.season, t.respondDay)}</span>;
      if (t?.counter) return <a href={href('negotiate', ['fa', p.id])} className="pos">Countered: {t.counter.years} yr × {fmtMoney(t.counter.aav)}</a>;
      const rival = p.fa!.offers.filter((o) => o.orgId !== league.userOrgId).some((o) => offerScore(league, p, o) > offerScore(league, p, yourOffer(p)));
      return rival ? <span className="neg">Topped by another club</span> : <span className="muted">Your offer leads</span>;
    } },
    { key: 'dec', label: 'Decides', value: (p) => (p.fa!.pending ? -1 : p.fa!.decideDay), render: (p) => (p.fa!.pending ? <b className="pos" title="He accepted; the deal waits on your corresponding roster move">Agreed: needs a {pendingBlock(league, league.userOrgId) ?? 'roster'} spot</b> : dayShort(league.season, p.fa!.decideDay)) },
    { key: 'wd', label: '', noSort: true, render: (p) => p.fa!.pending ? (
      <span className="nowrap">
        <button className="btn btn-sm btn-primary" disabled={!!pendingBlock(league, league.userOrgId)} title={pendingBlock(league, league.userOrgId) ? 'Open a spot first (Roster Moves)' : 'Make it official now'} onClick={() => { finalizePending(league); changed(); }}>Finalize</button>{' '}
        <a className="btn btn-sm" href={href('roster-moves')}>Roster Moves</a>{' '}
        <button className="btn btn-sm" onClick={() => { withdrawOffer(p, league.userOrgId, league); changed(); }}>Back out</button>
      </span>
    ) : <span className="nowrap"><a className="btn btn-sm" href={href('negotiate', ['fa', p.id])}>Revise</a>{' '}<button className="btn btn-sm" onClick={() => { withdrawOffer(p, league.userOrgId, league); changed(); }}>Withdraw</button></span> },
  ];
  const milbCols: Column<Player>[] = [
    ...base,
    { key: 'svc', label: 'Svc', value: (p) => p.mlServiceDays, render: (p) => serviceLabel(p.mlServiceDays, league.settings) },
    { key: 'sign', label: '', noSort: true, render: (p) => <MilbCell p={p} /> },
  ];

  return (
    <>
      <h1>Free Agents</h1>
      {(() => { const st = faStage(league); return st ? <p className="alert alert-info small" style={{ margin: '4px 0 8px' }}><b>{st.stage}.</b> {st.detail}</p> : null; })()}
      <div className="btn-group tabs">
        <button className={`btn btn-sm${tab === 'ml' ? ' active' : ''}`} onClick={() => go('free-agents', [], { tab: 'ml' })}>Major league ({ml.length - upcoming.length}{upcoming.length ? ` + ${upcoming.length} upcoming` : ''})</button>
        <button className={`btn btn-sm${tab === 'milb' ? ' active' : ''}`} onClick={() => go('free-agents', [], { tab: 'milb' })}>Minor league ({milb.length})</button>
      </div>
      <div className="form-row" style={{ margin: '6px 0' }}>
        <PosFilterSelect value={pf} onChange={setPf} />{' '}
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
            Make an offer and the player weighs it against everyone else's when he decides: money, years, how good the team is and, for his old club, loyalty. "Interest" previews how your offer stacks up against what he's asking. Contracts start in {start}. If your 40-man (or, in season, the active roster) is full when he says yes, the deal is agreed and becomes official once you make a corresponding move ({fortyMan(league, league.userOrgId).length}/{league.settings.fortyMax} on the 40-man now).
          </p>
          {(mineOffers.length > 0 || bidResults.length > 0) && (
            <div className="box" style={{ margin: '6px 0 10px' }}>
              <h3 style={{ margin: '0 0 4px' }}>Your bids</h3>
              {mineOffers.length > 0
                ? <DataTable cols={bidCols} rows={mineOffers} rowKey={(p) => p.id} defaultSort={{ key: 'ovr', desc: true }} compact />
                : <p className="muted small">No open offers.</p>}
              {bidResults.length > 0 && (
                <div className="small" style={{ marginTop: 6 }}>
                  <b>Results this winter:</b>{' '}
                  {bidResults.map((m, i) => <span key={m.id} className={m.subject.endsWith('with you') ? 'pos' : 'muted'}>{i ? ' · ' : ''}{m.subject}</span>)}
                </div>
              )}
            </div>
          )}
          <DataTable cols={mlCols} rows={ml} rowKey={(p) => p.id} defaultSort={{ key: 'ovr', desc: true }} compact />
        </>
      ) : (
        <>
          <p className="muted small">Minor league deals have a short bidding window: make an offer (affiliate level, plus an optional invite to big league camp), other clubs may bid, and in a few days (a day or two in season) he picks the best fit: a higher level, a camp invite and a clear path to the majors all help.{delegated(league, league.orgs[league.userOrgId], 'milbfa') ? ' Your assistant GM also bids for you each week in the winter and spring to fill thin spots at Triple-A.' : ''}</p>
          <DataTable cols={milbCols} rows={milb} rowKey={(p) => p.id} defaultSort={{ key: 'ovr', desc: true }} compact pinned={(p) => milbOffers(p).some((o) => o.orgId === league.userOrgId)} />
        </>
      )}
    </>
  );
}
