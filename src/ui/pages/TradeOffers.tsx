import { useStore, changed, setMessage, askConfirm } from '../../store.ts';
import { href } from '../../router.ts';
import { executeTrade, validateTrade, rosterTodo } from '../../core/trade.ts';
import { posLabel } from '../../core/rules.ts';
import { scoutedOvr, scoutedPot } from '../../core/ratings.ts';
import { fmtMoney } from '../../core/contracts.ts';
import { dayShort } from '../../core/settings.ts';
import { Rating } from '../components.tsx';
import { ContractCell } from '../fmt.tsx';
import { seasonSummary } from '../tradeCols.tsx';
import type { League, TradeAssets } from '../../core/types.ts';

function Assets({ league, a }: { league: League; a: TradeAssets }) {
  return (
    <>
      {a.pids.map((id) => {
        const p = league.players[id];
        if (!p) return null;
        return (
          <div key={id}>
            <a href={href('player', [id])}>{p.first} {p.last}</a> {posLabel(p)}, {league.season - p.born}, {p.level} <Rating v={scoutedOvr(league, p)} />/<Rating v={scoutedPot(league, p)} />{' '}
            <span className="muted small"><ContractCell league={league} p={p} /></span>{(() => { const s = seasonSummary(league, p); return s ? <span className="small" title={s.tip} style={{ cursor: 'help' }}> · {s.levels.join('/')}: {s.line}{s.wrc !== null ? `, wRC+ ${s.wrc}` : `, FIP- ${s.fipm}`}</span> : null; })()}
          </div>
        );
      })}
      {a.cash > 0 && <div>{fmtMoney(a.cash)} cash</div>}
      {a.pool > 0 && <div>{fmtMoney(a.pool)} international pool money</div>}
    </>
  );
}

export default function TradeOffers() {
  const { league } = useStore();
  if (!league) return null;
  const offers = league.tradeOffers;
  return (
    <>
      <h1>Trade Offers</h1>
      <p className="muted small">Clubs reach out on their own, most often in the weeks before the deadline and during the winter (especially the Winter Meetings). Put players on your <a href={href('trading-block')}>trading block</a> or set what you're interested in to steer the calls. Offers expire after 3 days. Your assistant GM can answer them for you (Staff page).</p>
      {offers.length === 0 && <p className="muted">No offers right now.</p>}
      {offers.map((o) => {
        const ai = league.orgs[o.fromOrg];
        const err = validateTrade(league, o.proposal);
        return (
          <div key={o.id} className="series" style={{ maxWidth: 820 }}>
            <b>{ai.affiliates.MLB.name}</b> <span className="muted small">({ai.strategy}, {ai.stance.toLowerCase()}) · {dayShort(league.season, o.day)}, expires {dayShort(league.season, o.expires)}</span>
            {o.note && <div className="small">"{o.note[0].toUpperCase() + o.note.slice(1)}"</div>}
            <div className="cards" style={{ marginTop: 6 }}>
              <div className="box"><div className="muted small">They give</div><Assets league={league} a={o.proposal.give[0]} /></div>
              <div className="box"><div className="muted small">You give</div><Assets league={league} a={o.proposal.give[1]} /></div>
            </div>
            {err && <div className="neg small">{err}</div>}
            <div className="form-row">
              <button
                className="btn btn-sm btn-primary"
                disabled={!!err}
                onClick={async () => {
                  if (!(await askConfirm(`Accept the ${ai.affiliates.MLB.name}' offer?`))) return;
                  const e = executeTrade(league, o.proposal);
                  setMessage(e ?? `Trade completed.${rosterTodo(league)}`);
                  league.tradeOffers = league.tradeOffers.filter((x) => x.id !== o.id);
                  changed();
                }}
              >
                Accept
              </button>
              <button className="btn btn-sm" onClick={() => { league.tradeOffers = league.tradeOffers.filter((x) => x.id !== o.id); changed(); }}>Decline</button>
              <a className="btn btn-sm" href={href('trade', [], { org: ai.id, offer: o.id })}>Counter in the trade screen</a>
            </div>
          </div>
        );
      })}
    </>
  );
}
