import { useState } from 'react';
import { useStore, changed, setMessage, askConfirm } from '../../store.ts';
import { href } from '../../router.ts';
import type { Pos, TradeProposal, TradeStance } from '../../core/types.ts';
import { TRADE_STANCES } from '../../core/types.ts';
import { aiCounterFor, emptyAssets, evaluate, executeTrade, playerTradeBlock, tradeWindowOpen, rosterTodo } from '../../core/trade.ts';
import { posLabel } from '../../core/rules.ts';
import { orgPlayers } from '../../core/util.ts';
import { NEED_POS, STANCE_HELP, teamNeeds } from '../../core/market.ts';
import { DataTable, Rating, type Column } from '../components.tsx';
import { scoutedOvr, scoutedPot } from '../../core/ratings.ts';
import { tradePlayerCols } from '../tradeCols.tsx';
import type { Player } from '../../core/types.ts';

let leagueFilter = { org: -1, pos: '' as Pos | '' };

export default function TradingBlock() {
  const { league } = useStore();
  const [offers, setOffers] = useState<TradeProposal[] | null>(null);
  const [lf, setLfState] = useState(leagueFilter);
  const setLf = (v: typeof lf) => { leagueFilter = v; setLfState(v); };
  if (!league) return null;
  const user = league.orgs[league.userOrgId];
  const mine = orgPlayers(league, user.id)
    .filter((p) => !playerTradeBlock(league, p))
    .sort((a, b) => (user.block.includes(b.id) ? 1 : 0) - (user.block.includes(a.id) ? 1 : 0) || (a.level === 'MLB' ? 0 : 1) - (b.level === 'MLB' ? 0 : 1) || scoutedOvr(league, b) - scoutedOvr(league, a));
  const window = tradeWindowOpen(league);
  const needs = teamNeeds(league, user.id);
  const watched = user.interest.pids.map((id) => league.players[id]).filter(Boolean);
  const nameCol: Column<Player> = { key: 'name', label: 'Name', left: true, value: (p) => `${p.last} ${p.first}`, render: (p) => <a href={href('player', [p.id])}>{p.first} {p.last}</a> };
  const watchCols: Column<Player>[] = [
    nameCol,
    { key: 'team', label: 'Team', value: (p) => (p.orgId !== null ? league.orgs[p.orgId].abbrev : 'FA') },
    ...tradePlayerCols(league),
    {
      key: 'act', label: '', noSort: true,
      render: (p) => (
        <span className="nowrap">
          {p.orgId !== null && <a className="btn btn-sm" href={href('trade', [], { org: p.orgId, pid: p.id })}>Trade for</a>}{' '}
          <button className="btn btn-sm" onClick={() => { user.interest.pids = user.interest.pids.filter((x) => x !== p.id); changed(); }}>Remove</button>
        </span>
      ),
    },
  ];
  // Every other club's trading block.
  const others = league.orgs.filter((o) => o.id !== user.id);
  const leagueBlock = others
    .filter((o) => lf.org < 0 || o.id === lf.org)
    .flatMap((o) => o.block.map((id) => league.players[id]).filter((p) => p && p.orgId === o.id))
    .filter((p) => !lf.pos || p.pos === lf.pos);
  const leagueCols: Column<Player>[] = [
    nameCol,
    { key: 'team', label: 'Team', value: (p) => league.orgs[p.orgId!].abbrev },
    { key: 'stance', label: 'Stance', left: true, value: (p) => league.orgs[p.orgId!].stance, render: (p) => { const s = league.orgs[p.orgId!].stance; return <span title={STANCE_HELP[s]} className={s === 'Buying' ? 'pos' : s === 'Selling' ? 'neg' : ''}>{s}</span>; } },
    ...tradePlayerCols(league),
    {
      key: 'act', label: '', noSort: true,
      render: (p) => (
        <span className="nowrap">
          <a className="btn btn-sm" href={href('trade', [], { org: p.orgId!, pid: p.id })}>Trade for</a>{' '}
          <button className="btn btn-sm" onClick={() => { user.interest.pids = user.interest.pids.includes(p.id) ? user.interest.pids.filter((x) => x !== p.id) : [...user.interest.pids, p.id]; changed(); }}>{user.interest.pids.includes(p.id) ? 'Unwatch' : 'Watch'}</button>
        </span>
      ),
    },
  ];

  const blockCols: Column<Player>[] = [
    { key: 'blk', label: 'Block', value: (p) => (user.block.includes(p.id) ? 1 : 0), sortDesc: true, render: (p) => <input type="checkbox" checked={user.block.includes(p.id)} onChange={() => toggleBlock(p.id)} /> },
    nameCol,
    ...tradePlayerCols(league),
  ];

  const toggleBlock = (id: number) => {
    user.block = user.block.includes(id) ? user.block.filter((x) => x !== id) : [...user.block, id];
    changed();
  };
  const togglePos = (pos: Pos) => {
    user.interest.pos = user.interest.pos.includes(pos) ? user.interest.pos.filter((x) => x !== pos) : [...user.interest.pos, pos];
    changed();
  };

  const ask = () => {
    const out: { prop: TradeProposal; v: number }[] = [];
    for (const org of league.orgs) {
      if (org.id === user.id) continue;
      const c = aiCounterFor(league, org, { ...emptyAssets(), pids: user.block });
      if (c) out.push({ prop: c, v: evaluate(league, user, c).dv });
    }
    out.sort((a, b) => b.v - a.v);
    setOffers(out.slice(0, 8).map((x) => x.prop));
  };

  return (
    <>
      <h1>Trading Block</h1>
      {window && <div className="alert alert-warn">{window}.</div>}

      <div className="form-row">
        <b>Your stance:</b>{' '}
        <select
          value={user.stance}
          onChange={(e) => {
            user.stance = e.target.value as TradeStance;
            changed();
          }}
        >
          {TRADE_STANCES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>{' '}
        <span className="muted small">{STANCE_HELP[user.stance]}. Other clubs see this: buying brings offers for veterans, selling brings offers for your veterans, standing pat cuts calls.</span>
      </div>

      <h2>Interested in</h2>
      <p className="muted small">Clubs with matching players on their block, and clubs that own players you're watching, will reach out. Your weakest spots right now: {needs.length ? needs.join(', ') : 'none'}.</p>
      <div className="btn-group">
        {NEED_POS.map((pos) => (
          <button key={pos} className={`btn btn-sm${user.interest.pos.includes(pos) ? ' active' : ''}`} onClick={() => togglePos(pos)}>{pos}</button>
        ))}
      </div>
      <h3>Watch list</h3>
      {watched.length === 0 ? (
        <p className="muted small">No one yet. Use "Watch" on a player's page or on the <a href={href('trade-market')}>Trade Market</a>.</p>
      ) : (
        <DataTable cols={watchCols} rows={watched} rowKey={(p) => p.id} compact />
      )}

      <h2>Other clubs' blocks</h2>
      <p className="muted small">Everyone the other 29 clubs are shopping ({others.reduce((t, o) => t + o.block.length, 0)} players). Sellers shop veterans, buyers dangle upper-minors players, clubs listening shop spare parts; clubs standing pat aren't shopping anyone. Blocks change as stances shift.</p>
      <div className="form-row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <select value={lf.org} onChange={(e) => setLf({ ...lf, org: Number(e.target.value) })}>
          <option value={-1}>All teams</option>
          {[...others].sort((a, b) => a.abbrev.localeCompare(b.abbrev)).map((o) => <option key={o.id} value={o.id}>{o.abbrev} ({o.block.length}, {o.stance.toLowerCase()})</option>)}
        </select>
        <select value={lf.pos} onChange={(e) => setLf({ ...lf, pos: e.target.value as Pos | '' })}>
          <option value="">All positions</option>
          {NEED_POS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      {leagueBlock.length === 0
        ? <p className="muted small">Nobody matching that is on a block right now.</p>
        : <DataTable cols={leagueCols} rows={leagueBlock} rowKey={(p) => p.id} defaultSort={{ key: 'ovr', desc: true }} compact maxHeight={420} />}

      <h2>Your block</h2>
      <p className="muted small">Checked players are shopped to the league; AI clubs reach out about them, mostly before the deadline and during the winter. "Get offers now" asks every club at once.</p>
      <DataTable cols={blockCols} rows={mine} rowKey={(p) => p.id} compact maxHeight={360} />
      <button className="btn btn-primary" disabled={!user.block.length || !!window} onClick={ask}>Get offers now</button>
      {offers && (
        <>
          <h2>Offers</h2>
          {offers.length === 0 && <p className="muted">Nobody bit.</p>}
          {offers.map((o, i) => {
            const ai = league.orgs[o.orgs[0]];
            return (
              <div key={i} className="series" style={{ maxWidth: 760 }}>
                <b>{ai.affiliates.MLB.name}</b> <span className="muted small">({ai.strategy}, {ai.stance.toLowerCase()})</span> offer:{' '}
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
                    setMessage(err ?? `Trade completed with the ${ai.affiliates.MLB.name}.${rosterTodo(league)}`);
                    setOffers(null);
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
