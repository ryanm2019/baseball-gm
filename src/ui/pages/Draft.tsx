import { useStore, changed, setMessage } from '../../store.ts';
import { href, go, useRoute } from '../../router.ts';
import type { Player } from '../../core/types.ts';
import { advanceDraft, availableProspects, canSign, isProspect, onTheClock, poolSpent, poolTotal, signPick, userAutoPick, userPick, POOL_ROUNDS } from '../../core/draft.ts';
import { fmtMoney } from '../../core/contracts.ts';
import { posLabel } from '../../core/rules.ts';
import { dayLabel, dayShort } from '../../core/settings.ts';
import { DataTable, type Column } from '../components.tsx';
import { bt, nameCol, ratingCols } from '../fmt.tsx';
import { delegated } from '../../core/staff.ts';

export default function Draft() {
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
    { key: 'school', label: 'From', left: true, value: (p) => (p.prospect?.college ? 'College' : 'High school') },
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
            if (!err) advanceDraft(league);
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
      {!d && (
        <p>
          The draft is {dayLabel(league.season, league.settings.draftDay)} (All-Star break), {league.settings.draftRounds} rounds. The top six picks go by lottery among non-playoff teams. Scout the class below.
        </p>
      )}
      {d && !d.done && (
        <div className={`alert ${myTurn ? 'alert-warn' : 'alert-info'}`}>
          Pick #{clock?.pick} (round {clock?.round}): {clock ? league.orgs[clock.orgId].affiliates.MLB.name : ''} {myTurn ? "— you're on the clock." : ''}{' '}
          {myTurn && (
            <button className="btn btn-sm" onClick={() => { userAutoPick(league); advanceDraft(league); changed(); }}>
              Let the assistant GM pick
            </button>
          )}{' '}
          <button className="btn btn-sm" onClick={() => { while (league.draft && !league.draft.done) advanceDraft(league, true); changed(); }}>
            Auto-draft the rest
          </button>
        </div>
      )}
      {d?.done && (
        <p>
          The draft is over. Signing deadline: <b>{dayShort(league.season, d.deadline)}</b>. Bonus pool {fmtMoney(pool)} · spent {fmtMoney(spent)} · {fmtMoney(pool - spent)} left (up to 5% over is allowed).
          {delegated(league, org, 'draft') && ' Your assistant GM signs your picks.'}
        </p>
      )}
      {d && d.lottery.length > 0 && <p className="small muted">Lottery: {d.lottery.map((l) => `#${l.pick} ${league.orgs[l.orgId].abbrev} (from ${l.from})`).join(' · ')}</p>}
      <div className="btn-group tabs">
        <button className={`btn btn-sm${tab === 'board' ? ' active' : ''}`} onClick={() => go('draft', [], { tab: 'board' })}>Available ({avail.length})</button>
        {d && <button className={`btn btn-sm${tab === 'mine' ? ' active' : ''}`} onClick={() => go('draft', [], { tab: 'mine' })}>My picks</button>}
        {d && <button className={`btn btn-sm${tab === 'all' ? ' active' : ''}`} onClick={() => go('draft', [], { tab: 'all' })}>All picks</button>}
      </div>
      {tab === 'board' && <DataTable cols={cols} rows={avail} rowKey={(p) => p.id} defaultSort={{ key: 'pot', desc: true }} compact />}
      {tab === 'mine' && d && (
        <table className="data compact">
          <thead><tr><th>Pick</th><th>Rd</th><th className="l">Player</th><th>Slot</th><th>Asking</th><th className="l">Status</th><th /></tr></thead>
          <tbody>
            {myPicks.map((pk) => {
              const p = pk.pid !== null ? league.players[pk.pid] : null;
              const why = canSign(league, pk);
              return (
                <tr key={pk.pick}>
                  <td>{pk.pick}</td>
                  <td>{pk.round}</td>
                  <td className="l">{p ? <a href={href('player', [p.id])}>{p.first} {p.last}</a> : '-'} {p && <span className="muted small">{posLabel(p)}</span>}</td>
                  <td>{pk.round <= POOL_ROUNDS ? fmtMoney(pk.slot) : '-'}</td>
                  <td>{p?.prospect?.asking ? fmtMoney(p.prospect.asking) : p?.contract.bonus ? fmtMoney(p.contract.bonus) : '-'}</td>
                  <td className="l">{pk.signed ? 'Signed' : pk.signed === false ? 'Did not sign' : p ? 'Unsigned' : ''}</td>
                  <td>
                    {p && pk.signed === null && (
                      <button className="btn btn-sm" disabled={!!why} title={why ?? ''} onClick={() => { setMessage(signPick(league, pk, p)); changed(); }}>
                        Sign
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
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
