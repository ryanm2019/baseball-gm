import { useStore, changed, setMessage } from '../../store.ts';
import { href, go, useRoute } from '../../router.ts';
import type { League, Player } from '../../core/types.ts';
import { scoutedPot } from '../../core/ratings.ts';
import { advanceDraft, advanceOnePick, projectedPick, availableProspects, createDraft, isProspect, offerPick, onTheClock, overageTier, poolSpent, poolTotal, signabilityLabel, userAutoPick, userPick, willingness, willingnessBand, POOL_ROUNDS, LATE_ROUND_FREE } from '../../core/draft.ts';
import { useState } from 'react';
import type { DraftPick } from '../../core/types.ts';
import { fmtMoney } from '../../core/contracts.ts';
import { posLabel } from '../../core/rules.ts';
import { dayLabel, dayShort } from '../../core/settings.ts';
import { DataTable, type Column, NumInput } from '../components.tsx';
import { bt, nameCol, ratingCols } from '../fmt.tsx';
import { delegated } from '../../core/staff.ts';

// Board filters (kept while you move around the app).
const boardFilter = { pos: 'all', from: 'all', sign: 'all', q: '', all: false };
const POS_GROUPS: Record<string, (p: Player) => boolean> = {
  all: () => true,
  hitters: (p) => p.pos !== 'SP' && p.pos !== 'RP',
  C: (p) => p.pos === 'C',
  IF: (p) => ['1B', '2B', '3B', 'SS'].includes(p.pos),
  OF: (p) => ['LF', 'CF', 'RF'].includes(p.pos),
  pitchers: (p) => p.pos === 'SP' || p.pos === 'RP',
  SP: (p) => p.pos === 'SP',
  RP: (p) => p.pos === 'RP',
};
const fromOf = (p: Player) => (p.prospect?.college ? 'college' : 'hs');

export default function Draft() {
  const [f, setF] = useState(boardFilter);
  const setFilter = (x: Partial<typeof boardFilter>) => { Object.assign(boardFilter, x); setF({ ...boardFilter }); };
  const { league } = useStore();
  const route = useRoute();
  if (!league) return null;
  const org = league.orgs[league.userOrgId];
  const d = league.draft && league.draft.season === league.season ? league.draft : null;
  const clock = onTheClock(league);
  const myTurn = clock?.orgId === org.id;
  const tab = route.query.tab ?? (d?.done ? 'mine' : 'board');
  const avail = d ? availableProspects(league) : Object.values(league.players).filter((p) => isProspect(p, league.season));

  const cols: Column<Player>[] = [
    nameCol(league),
    { key: 'pos', label: 'Pos', value: (p) => posLabel(p) },
    { key: 'bt', label: 'B/T', value: bt },
    { key: 'age', label: 'Age', value: (p) => league.season - p.born },
    { key: 'school', label: 'From', left: true, value: (p) => (p.prospect?.cls === 'SR' ? 'College senior' : p.prospect?.college ? 'College junior' : 'High school') },
    { key: 'sign', label: 'Signability', left: true, value: (p) => signabilityLabel(league, p), render: (p) => { const t = signabilityLabel(league, p); return <span className={t.startsWith('Tough') ? 'neg' : t.includes('cheap') ? 'pos' : ''}>{t}</span>; } },
    ...ratingCols(league),
  ];
  if (myTurn) {
    cols.push({
      key: 'pick',
      label: '',
      noSort: true,
      render: (p) => (
        <button
          className="btn btn-sm btn-primary"
          onClick={() => {
            const err = userPick(league, p);
            setMessage(err);
            changed();
          }}
        >
          Draft
        </button>
      ),
    });
  }

  const myPicks = d ? d.picks.filter((pk) => pk.orgId === org.id) : [];
  const pool = poolTotal(league, org.id);
  const spent = poolSpent(league, org.id);

  return (
    <>
      <h1>{league.season} Amateur Draft</h1>
      {d ? (() => {
        const next = myPicks.find((pk) => pk.pick > d.index);
        return (
          <p className="small">
            <b>Your picks:</b> {myPicks.length ? myPicks.map((pk) => `#${pk.pick}${pk.label ? ` (${pk.label})` : ` (R${pk.round})`}`).join(', ') : 'none (traded away or forfeited)'}
            {!d.done && next && <> · <b>{next.pick - 1 === d.index ? "You're on the clock" : `Next up: #${next.pick}, in ${next.pick - 1 - d.index} pick${next.pick - 1 - d.index === 1 ? '' : 's'}`}</b></>}
          </p>
        );
      })() : (() => {
        const pr = projectedPick(league, org.id);
        return <p className="small"><b>Your first-round pick:</b> {pr ? <>#{pr.pick} by last season's standings{pr.lottery ? '; as a non-playoff club you are in the lottery for the top six picks, so it could move up' : ''}.</> : 'set on draft day (this league has no prior standings, so the order follows club strength, with a lottery for the top six).'} Competitive balance and compensation picks are added when the order is set.</p>;
      })()}
      {!d && (
        <p>
          The draft is {dayLabel(league.season, league.settings.draftDay)} (All-Star break), {league.settings.draftRounds} rounds. The top six picks go by lottery among non-playoff teams. Scout the class below.{' '}
          {league.phase === 'regular' && league.day === league.settings.draftDay && (
            <button
              className="btn btn-primary"
              onClick={() => {
                league.draft = createDraft(league);
                changed();
              }}
            >
              Start the draft
            </button>
          )}
        </p>
      )}
      {d && !d.done && (
        <div className={`alert ${myTurn ? 'alert-warn' : 'alert-info'}`}>
          Pick #{clock?.pick} (round {clock?.round}): {clock ? league.orgs[clock.orgId].affiliates.MLB.name : ''} {myTurn ? "— you're on the clock." : ''}{' '}
          {myTurn ? (
            <button className="btn btn-sm" onClick={() => { userAutoPick(league); changed(); }}>
              Let the assistant GM pick
            </button>
          ) : (
            <>
              <button className="btn btn-sm btn-primary" onClick={() => { advanceOnePick(league); changed(); }}>Next pick</button>{' '}
              <button className="btn btn-sm" onClick={() => { advanceDraft(league); changed(); }}>Sim to my pick</button>
            </>
          )}{' '}
          <button className="btn btn-sm" onClick={() => { while (league.draft && !league.draft.done) advanceDraft(league, true); changed(); }}>
            Auto-draft the rest
          </button>
          {d.index > 0 && (
            <div className="small" style={{ marginTop: 4 }}>
              Latest: {d.picks.slice(Math.max(0, d.index - 5), d.index).reverse().map((pk) => {
                const p = pk.pid !== null ? league.players[pk.pid] : null;
                return (
                  <span key={pk.pick} className={pk.orgId === org.id ? 'pos' : ''} style={{ marginRight: 10 }}>
                    #{pk.pick} {league.orgs[pk.orgId].abbrev}: {p ? <a href={href('player', [p.id])}>{p.first[0]}. {p.last}</a> : '-'} {p ? <span className="muted">{posLabel(p)}, {p.prospect?.college ? 'college' : 'HS'}</span> : ''}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}
      {d?.done && (
        <p>
          The draft is over. Signing deadline: <b>{dayShort(league.season, d.deadline)}</b>. Bonus pool {fmtMoney(pool)} · spent {fmtMoney(spent)} · <span className={spent > pool ? 'neg' : ''}>{fmtMoney(pool - spent)} left</span>.{' '}
          {spent > pool && <span className="neg">Over the pool: {overageTier(spent - pool, pool).text}.</span>}
          {delegated(league, org, 'draft') && ' Your assistant GM signs your picks.'}
        </p>
      )}
      {d && d.lottery.length > 0 && <p className="small muted">Lottery: {d.lottery.map((l) => `#${l.pick} ${league.orgs[l.orgId].abbrev} (from ${l.from})`).join(' · ')}</p>}
      <div className="btn-group tabs">
        <button className={`btn btn-sm${tab === 'board' ? ' active' : ''}`} onClick={() => go('draft', [], { tab: 'board' })}>Available ({avail.length})</button>
        {d && <button className={`btn btn-sm${tab === 'mine' ? ' active' : ''}`} onClick={() => go('draft', [], { tab: 'mine' })}>My picks</button>}
        {d && <button className={`btn btn-sm${tab === 'all' ? ' active' : ''}`} onClick={() => go('draft', [], { tab: 'all' })}>All picks</button>}
      </div>
      {tab === 'board' && (() => {
        const q = f.q.trim().toLowerCase();
        const shown = avail.filter((p) => POS_GROUPS[f.pos](p) && (f.from === 'all' || fromOf(p) === f.from)
          && (f.sign === 'all' || !signabilityLabel(league, p).startsWith('Tough')) && (!q || `${p.first} ${p.last}`.toLowerCase().includes(q)));
        // Without "show all", list the 150 best by potential (sorting still works within them).
        const rows = f.all || shown.length <= 150 ? shown : topByPot(league, shown, 150);
        return (
          <>
            <div className="form-row" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
              <select value={f.pos} onChange={(e) => setFilter({ pos: e.target.value })}>
                <option value="all">All positions</option><option value="hitters">Hitters</option><option value="C">C</option><option value="IF">Infield</option><option value="OF">Outfield</option>
                <option value="pitchers">Pitchers</option><option value="SP">SP</option><option value="RP">RP</option>
              </select>
              <select value={f.from} onChange={(e) => setFilter({ from: e.target.value })}>
                <option value="all">High school + college</option><option value="hs">High school</option><option value="college">College</option>
              </select>
              <select value={f.sign} onChange={(e) => setFilter({ sign: e.target.value })}>
                <option value="all">Any signability</option><option value="signable">Hide tough signs</option>
              </select>
              <input placeholder="Name" value={f.q} onChange={(e) => setFilter({ q: e.target.value })} style={{ width: 130 }} />
              <label className="small"><input type="checkbox" checked={f.all} onChange={(e) => setFilter({ all: e.target.checked })} /> Show all {shown.length}</label>
              {!f.all && shown.length > 150 && <span className="muted small">Showing the top 150 by potential.</span>}
            </div>
            <DataTable cols={cols} rows={rows} rowKey={(p) => p.id} defaultSort={{ key: 'pot', desc: true }} compact />
          </>
        );
      })()}
      {tab === 'mine' && d && <MyPicks picks={myPicks} />}
      {tab === 'all' && d && (
        <table className="data compact">
          <thead><tr><th>Pick</th><th>Rd</th><th className="l">Team</th><th className="l">Player</th><th>Pos</th><th>Age</th><th className="l">Signed</th></tr></thead>
          <tbody>
            {d.picks.filter((pk) => pk.pid !== null).map((pk) => {
              const p = league.players[pk.pid!];
              return (
                <tr key={pk.pick} className={pk.orgId === org.id ? 'user' : ''}>
                  <td>{pk.pick}</td><td>{pk.round}</td><td className="l">{league.orgs[pk.orgId].abbrev}</td>
                  <td className="l">{p ? <a href={href('player', [p.id])}>{p.first} {p.last}</a> : '(gone)'}</td>
                  <td>{p ? posLabel(p) : ''}</td><td>{p ? league.season - p.born : ''}</td>
                  <td className="l">{pk.signed ? 'Yes' : pk.signed === false ? 'No' : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}

// Negotiate with your picks: set an offer, read the meter, make one official offer per pick per day.
function MyPicks({ picks }: { picks: DraftPick[] }) {
  const { league } = useStore();
  const [amt, setAmt] = useState<Record<number, number>>({});
  if (!league) return null;
  const org = league.orgs[league.userOrgId];
  const pool = poolTotal(league, org.id);
  const spent = poolSpent(league, org.id);
  const done = !!league.draft?.done;
  // Unsigned top-10-round picks at their slots: what the rest of the class costs if each signs at slot.
  const atSlot = picks.filter((pk) => pk.signed === null && pk.round <= POOL_ROUNDS).reduce((t, pk) => t + pk.slot, 0);
  const left = pool - spent;
  const tiers = [0, 0.05, 0.1, 0.15].map((r) => pool * (1 + r) - spent);
  return (
    <>
      <div className="kv" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 18px', margin: '4px 0 8px' }}>
        <span>Bonus pool <b>{fmtMoney(pool)}</b></span>
        <span>Signed <b>{fmtMoney(spent)}</b></span>
        <span>Left to spend <b className={left < 0 ? 'neg' : 'pos'}>{fmtMoney(left)}</b></span>
        <span title="If every unsigned pick in rounds 1-10 signs for exactly his slot">Unsigned picks at slot <b>{fmtMoney(atSlot)}</b></span>
        <span title="What you'd have left after signing every unsigned top-10-round pick at slot (an unsigned pick's slot leaves the pool)">Left after slots <b className={left - atSlot < 0 ? 'neg' : ''}>{fmtMoney(left - atSlot)}</b></span>
      </div>
      <p className="small muted" style={{ marginTop: 0 }}>
        Room before each penalty: {tiers[0] > 0 ? <>none until you pass the pool ({fmtMoney(tiers[0])} left)</> : 'you are over the pool'}
        {' · '}up to 5% over (75% tax): {fmtMoney(Math.max(0, tiers[1]))}
        {' · '}up to 10% (lose next year's 1st): {fmtMoney(Math.max(0, tiers[2]))}
        {' · '}up to 15% (lose 1st and 2nd): {fmtMoney(Math.max(0, tiers[3]))}. Picks after round 10 count only above {fmtMoney(LATE_ROUND_FREE)}.
      </p>
      {!done && <p className="alert alert-info">Negotiations open once the draft is over: you can make offers to your picks then.</p>}
      <p className="muted small">
        Slide an offer to see how likely he is to sign, as your amateur scouts read it (better scouting gives a truer meter). You get one official offer per pick per day; lowballing him can raise his price. Most players come down a little as the deadline nears, but high schoolers with strong college commitments don't. Unsigned 1st and 2nd rounders bring a compensation pick next year. Pool penalties: up to 5% over, 75% tax; 5-10%, lose next year's 1st; 10-15%, 100% tax and lose a 1st and 2nd; over 15%, 100% tax and two 1sts. An unsigned top-10-round pick's slot comes out of your pool.
      </p>
      <table className="data compact">
        <thead><tr><th>Pick</th><th>Rd</th><th className="l">Player</th><th className="l">Signability</th><th>Slot</th><th>Offer</th><th /><th className="l">Meter</th><th /><th className="l">Status</th></tr></thead>
        <tbody>
          {picks.map((pk) => {
            const p = pk.pid !== null ? league.players[pk.pid] : null;
            if (!p) return <tr key={pk.pick}><td>{pk.pick}</td><td>{pk.round}</td><td className="l muted" colSpan={8}>-</td></tr>;
            const open = done && pk.signed === null && !!p.prospect;
            const lo = pk.round <= POOL_ROUNDS ? Math.round(pk.slot * 0.5) : 20_000;
            const hi = pk.round <= POOL_ROUNDS ? Math.round(pk.slot * 2) : 3_000_000;
            const def = pk.round <= POOL_ROUNDS ? pk.slot : LATE_ROUND_FREE;
            const a = amt[pk.pick] ?? p.prospect?.lastAmount ?? def;
            const w = open ? willingness(league, p, a) : 0;
            const charge = pk.round <= POOL_ROUNDS ? a : Math.max(0, a - LATE_ROUND_FREE);
            const after = spent + charge - pool;
            const offeredToday = p.prospect?.lastOffer === league.day;
            return (
              <tr key={pk.pick}>
                <td>{pk.pick}</td>
                <td>{pk.round}{pk.label ? ` ${pk.label}` : ''}</td>
                <td className="l"><a href={href('player', [p.id])}>{p.first} {p.last}</a> <span className="muted small">{posLabel(p)}, {league.season - p.born}</span></td>
                <td className="l small">{p.prospect ? signabilityLabel(league, p) : ''}</td>
                <td>{pk.round <= POOL_ROUNDS ? fmtMoney(pk.slot) : <span className="muted">$150k free</span>}</td>
                {open ? (
                  <>
                    <td className="nowrap">
                      <NumInput  step={0.05} min={0} style={{ width: 70 }} value={(a / 1e6).toFixed(2)} onChange={(n) => setAmt({ ...amt, [pk.pick]: Math.max(0, n * 1e6) })} /> $M
                    </td>
                    <td><input type="range" min={lo} max={hi} step={25_000} value={a} onChange={(e) => setAmt({ ...amt, [pk.pick]: Number(e.target.value) })} style={{ width: 110 }} /></td>
                    <td className="l nowrap">
                      <span className="meter"><span className="meter-fill" style={{ width: `${Math.round(w * 100)}%`, background: w >= 0.65 ? '#2e8b57' : w >= 0.35 ? '#d4a017' : '#c0392b' }} /></span>{' '}
                      <span className="small">{willingnessBand(w)}</span>
                      {after > 0 && <div className="neg small">{fmtMoney(after)} over pool: {overageTier(after, pool).text}</div>}
                    </td>
                    <td>
                      <button
                        className="btn btn-sm btn-primary"
                        disabled={offeredToday}
                        title={offeredToday ? 'One offer per day: sim a day and try again' : ''}
                        onClick={() => {
                          const r = offerPick(league, pk, a);
                          setMessage(r.text);
                          changed();
                        }}
                      >
                        {offeredToday ? 'Offered today' : 'Make offer'}
                      </button>
                    </td>
                    <td className="l small">{p.prospect?.lastAmount ? `Last offer ${fmtMoney(p.prospect.lastAmount)}` : 'Unsigned'}</td>
                  </>
                ) : (
                  <td className="l" colSpan={5}>{pk.signed ? `Signed for ${fmtMoney(p.contract.bonus ?? 0)}` : pk.signed === false ? 'Did not sign' : ''}</td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

// The n best by the board's potential column.
function topByPot(league: League, ps: Player[], n: number): Player[] {
  return [...ps].sort((a, b) => scoutedPot(league, b) - scoutedPot(league, a)).slice(0, n);
}
