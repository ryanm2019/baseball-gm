import { useState } from 'react';
import { useStore, changed, setMessage, askConfirm } from '../../store.ts';
import { href } from '../../router.ts';
import type { TradeProposal } from '../../core/types.ts';
import { aiCounterFor, emptyAssets, evaluate, executeTrade, playerTradeBlock, tradeWindowOpen } from '../../core/trade.ts';
import { posLabel } from '../../core/rules.ts';
import { scoutedOvr, scoutedPot } from '../../core/ratings.ts';
import { fmtMoney } from '../../core/contracts.ts';
import { orgPlayers } from '../../core/util.ts';
import { Rating } from '../components.tsx';

export default function TradingBlock() {
  const { league } = useStore();
  const [sel, setSel] = useState<number[]>([]);
  const [offers, setOffers] = useState<TradeProposal[] | null>(null);
  if (!league) return null;
  const user = league.orgs[league.userOrgId];
  const mine = orgPlayers(league, user.id)
    .filter((p) => !playerTradeBlock(league, p))
    .sort((a, b) => (a.level === 'MLB' ? 0 : 1) - (b.level === 'MLB' ? 0 : 1) || scoutedOvr(league, b) - scoutedOvr(league, a));
  const window = tradeWindowOpen(league);

  const ask = () => {
    const out: { prop: TradeProposal; v: number }[] = [];
    for (const org of league.orgs) {
      if (org.id === user.id) continue;
      const c = aiCounterFor(league, org, { ...emptyAssets(), pids: sel });
      if (c) out.push({ prop: c, v: evaluate(league, user, c).dv });
    }
    out.sort((a, b) => b.v - a.v);
    setOffers(out.slice(0, 8).map((x) => x.prop));
  };

  return (
    <>
      <h1>Trading Block</h1>
      {window && <div className="alert alert-warn">{window}.</div>}
      <p className="muted small">Pick players you're willing to move, then see what every other club would offer for them.</p>
      <div className="table-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
        <table className="data compact">
          <thead><tr><th /><th className="l">Name</th><th>Pos</th><th>Age</th><th>Lvl</th><th>Ovr</th><th>Pot</th><th>Contract</th></tr></thead>
          <tbody>
            {mine.map((p) => (
              <tr key={p.id}>
                <td><input type="checkbox" checked={sel.includes(p.id)} onChange={() => setSel(sel.includes(p.id) ? sel.filter((x) => x !== p.id) : [...sel, p.id])} /></td>
                <td className="l"><a href={href('player', [p.id])}>{p.first} {p.last}</a></td>
                <td>{posLabel(p)}</td><td>{league.season - p.born}</td><td>{p.level}</td>
                <td><Rating v={scoutedOvr(league, p)} /></td><td><Rating v={scoutedPot(league, p)} /></td>
                <td>{p.contract.type === 'ML' ? `${fmtMoney(p.contract.salary)} → ${p.contract.exp}` : 'MiLB'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="btn btn-primary" disabled={!sel.length || !!window} onClick={ask}>Get offers</button>
      {offers && (
        <>
          <h2>Offers</h2>
          {offers.length === 0 && <p className="muted">Nobody bit.</p>}
          {offers.map((o, i) => {
            const ai = league.orgs[o.orgs[0]];
            return (
              <div key={i} className="series" style={{ maxWidth: 760 }}>
                <b>{ai.affiliates.MLB.name}</b> <span className="muted small">({ai.strategy})</span> offer:{' '}
                {o.give[0].pids.map((id) => {
                  const p = league.players[id];
                  return (
                    <span key={id} style={{ marginRight: 10 }}>
                      <a href={href('player', [id])}>{p.first} {p.last}</a> {posLabel(p)} {p.level} <Rating v={scoutedOvr(league, p)} />/<Rating v={scoutedPot(league, p)} />
                    </span>
                  );
                })}
                <button
                  className="btn btn-sm"
                  onClick={async () => {
                    if (!(await askConfirm(`Accept the ${ai.affiliates.MLB.name}' offer?`))) return;
                    const err = executeTrade(league, o);
                    setMessage(err ?? `Trade completed with the ${ai.affiliates.MLB.name}.`);
                    setOffers(null);
                    setSel([]);
                    changed();
                  }}
                >
                  Accept
                </button>
              </div>
            );
          })}
        </>
      )}
    </>
  );
}
