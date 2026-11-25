import { useState } from 'react';
import { useStore, changed, setMessage, askConfirm } from '../../store.ts';
import { go, href, useRoute } from '../../router.ts';
import type { League, Player, TradeAssets, TradeProposal, TradeTalk } from '../../core/types.ts';
import { correspondingMoves, emptyAssets, playerTradeBlock, validateTrade, hasTenAndFive, tradeWindowOpen } from '../../core/trade.ts';
import { agmRead, agmSuggestion, openTalks, sendOffer, withdrawOffer } from '../../core/negotiation.ts';
import { fmtMoney, orgPayroll } from '../../core/contracts.ts';
import { posLabel } from '../../core/rules.ts';
import { scoutedOvr } from '../../core/ratings.ts';
import { fortyMan, orgPlayers } from '../../core/util.ts';
import { shoppingFor } from '../../core/market.ts';
import { rushMany } from '../../core/scouting.ts';
import { DataTable, OrgSelect, StatusTags, type Column, NumInput } from '../components.tsx';
import { tradePlayerCols } from '../tradeCols.tsx';
import { seasonFraction } from '../../core/value.ts';

// The trade being built survives page changes.
let saved: { other: number; give: [TradeAssets, TradeAssets] } | null = null;

// Load a package (from the Trade Finder) into the trade screen.
export function loadTrade(other: number, give: [TradeAssets, TradeAssets]): void {
  saved = { other, give: JSON.parse(JSON.stringify(give)) };
  lastQuery = '';
}
let lastQuery = '';

const LEVEL_ORDER = ['MLB', 'AAA', 'AA', 'A+', 'A', 'CPX', 'DSL'];


function AssetTable({ league, orgId, assets, onToggle }: { league: League; orgId: number; assets: TradeAssets; onToggle: (pid: number) => void }) {
  const [lvl, setLvl] = useState('40');
  // Players in the deal stay pinned on top (even outside the level you're viewing).
  const ps = orgPlayers(league, orgId)
    .filter((p) => assets.pids.includes(p.id) || (lvl === '40' ? p.on40 : lvl === 'all' ? true : p.level === lvl))
    .sort((a, b) => LEVEL_ORDER.indexOf(a.level ?? 'AAA') - LEVEL_ORDER.indexOf(b.level ?? 'AAA') || scoutedOvr(league, b) - scoutedOvr(league, a));
  const cols: Column<Player>[] = [
    {
      key: 'pick', label: '', noSort: true,
      render: (p) => {
        const block = playerTradeBlock(league, p);
        return <input type="checkbox" title={block ?? ''} disabled={!!block} checked={assets.pids.includes(p.id)} onChange={() => onToggle(p.id)} />;
      },
    },
    {
      key: 'name', label: 'Name', left: true, value: (p) => `${p.last} ${p.first}`,
      render: (p) => <span title={hasTenAndFive(league, p) ? '10-and-5 rights: can veto a trade' : ''}><a href={href('player', [p.id])}>{p.first} {p.last}</a><StatusTags league={league} p={p} />{hasTenAndFive(league, p) && <span className="tag">10/5</span>}</span>,
    },
    ...tradePlayerCols(league),
  ];
  return (
    <>
      <div className="form-row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
        <div className="btn-group tabs" style={{ margin: 0 }}>
          {['40', 'MLB', 'AAA', 'AA', 'A+', 'A', 'CPX', 'DSL', 'all'].map((l) => (
            <button key={l} className={`btn btn-sm${lvl === l ? ' active' : ''}`} onClick={() => setLvl(l)}>
              {l === '40' ? '40-man' : l === 'all' ? 'All' : l}
            </button>
          ))}
        </div>
      </div>
      <DataTable cols={cols} rows={ps} rowKey={(p) => p.id} compact maxHeight={420} pinned={(p) => assets.pids.includes(p.id)} />
    </>
  );
}

function Extras({ league, orgId, assets, set }: { league: League; orgId: number; assets: TradeAssets; set: (a: TradeAssets) => void }) {
  const picks = league.cbPicks.filter((c) => c.orgId === orgId);
  const poolLeft = (league.intl.pools[orgId] ?? 0) - (league.intl.spent[orgId] ?? 0);
  return (
    <div className="form-row">
      Cash $<NumInput  step="0.25" min={0} style={{ width: 70 }} value={assets.cash / 1e6} onChange={(n) => set({ ...assets, cash: Math.max(0, Math.round(n * 4) / 4) * 1e6 })} />M
      {league.intl.open && (
        <>
          {' '}· Intl pool $<NumInput  step="0.25" min={0} style={{ width: 70 }} value={assets.pool / 1e6} onChange={(n) => set({ ...assets, pool: Math.max(0, Math.round(n * 4) / 4) * 1e6 })} />M <span className="muted small">({fmtMoney(poolLeft)} left)</span>
        </>
      )}
      {picks.map((c) => (
        <label key={c.id} style={{ marginLeft: 8 }}>
          <input type="checkbox" checked={assets.cbPicks.includes(c.id)} onChange={(e) => set({ ...assets, cbPicks: e.target.checked ? [...assets.cbPicks, c.id] : assets.cbPicks.filter((x) => x !== c.id) })} /> {c.season} CB-{c.round}
          {c.originalOrg !== orgId ? ` (from ${league.orgs[c.originalOrg].abbrev})` : ''}
        </label>
      ))}
    </div>
  );
}

function summary(league: League, a: TradeAssets): string {
  const parts = a.pids.map((id) => {
    const p = league.players[id];
    return p ? `${posLabel(p)} ${p.first} ${p.last}` : '?';
  });
  if (a.cash) parts.push(`${fmtMoney(a.cash)} cash`);
  if (a.pool) parts.push(`${fmtMoney(a.pool)} intl pool`);
  for (const id of a.cbPicks) parts.push(`CB pick ${id.split('-').slice(0, 2).join(' ')}`);
  return parts.length ? parts.join(', ') : 'nothing';
}

function salaryOf(league: League, a: TradeAssets): number {
  const f = seasonFraction(league);
  return a.pids.reduce((t, id) => t + (league.players[id]?.contract.type === 'ML' ? league.players[id].contract.salary * f : 0), 0) - a.cash;
}

export default function Trade() {
  const { league } = useStore();
  const route = useRoute();
  const [, force] = useState(0);
  if (!league) return null;
  const user = league.orgs[league.userOrgId];
  const otherDefault = route.query.org !== undefined ? Number(route.query.org) : saved?.other ?? (user.id === 0 ? 1 : 0);
  if (!saved || saved.other !== otherDefault) saved = { other: otherDefault, give: [emptyAssets(), emptyAssets()] };
  // Arriving from a player link (?pid=) or a trade offer (?offer=): start from that.
  const qKey = `${route.query.pid ?? ''}|${route.query.offer ?? ''}`;
  if (qKey !== '|' && qKey !== lastQuery) {
    lastQuery = qKey;
    const offer = league.tradeOffers.find((o) => String(o.id) === route.query.offer);
    if (offer) saved = { other: offer.fromOrg, give: [JSON.parse(JSON.stringify(offer.proposal.give[1])), JSON.parse(JSON.stringify(offer.proposal.give[0]))] };
    else if (route.query.pid && !saved.give[1].pids.includes(Number(route.query.pid))) saved.give[1].pids.push(Number(route.query.pid));
  }
  const st = saved;
  const other = league.orgs[st.other];
  const prop: TradeProposal = { orgs: [user.id, other.id], give: st.give };
  const refresh = () => force((x) => x + 1);
  const toggle = (i: 0 | 1, pid: number) => {
    const g = st.give[i];
    g.pids = g.pids.includes(pid) ? g.pids.filter((x) => x !== pid) : [...g.pids, pid];
    refresh();
  };
  const err = validateTrade(league, prop);
  const empty = !st.give[0].pids.length && !st.give[1].pids.length && !st.give[0].cash && !st.give[1].cash && !st.give[0].pool && !st.give[1].pool && !st.give[0].cbPicks.length && !st.give[1].cbPicks.length;
  const window = tradeWindowOpen(league);
  const userPay = orgPayroll(league, user);
  const otherPay = orgPayroll(league, other);
  const dUser = salaryOf(league, st.give[1]) - salaryOf(league, st.give[0]);
  const dOther = -dUser;
  const in40 = (i: number) => st.give[1 - i].pids.filter((id) => league.players[id]?.on40).length - st.give[i].pids.filter((id) => league.players[id]?.on40).length;

  // Offers go to the other front office; they answer in a day or two (same day at the deadline).
  const propose = async () => {
    if (err) return setMessage(err);
    if (!(await askConfirm(`Send the ${other.affiliates.MLB.name} an offer: ${summary(league, st.give[0])} for ${summary(league, st.give[1])}? If they accept, the trade goes through right away.`))) return;
    setMessage(sendOffer(league, prop));
    changed();
  };

  // His best guess at what gets it done; no guarantee until they answer.
  const balance = () => {
    const b = agmSuggestion(league, prop);
    if (!b) return setMessage(`Assistant GM: "I don't see a way to make this work with them."`);
    st.give = b.prop.give;
    setMessage(`Assistant GM: "${b.text}"`);
    refresh();
  };
  const read = !empty && !err ? agmRead(league, prop) : null;
  const talks = openTalks(league);
  const withThem = talks.filter((t) => t.orgId === other.id);

  return (
    <>
      <h1>Trade</h1>
      {window && <div className="alert alert-warn">{window}.</div>}
      <div className="form-row">
        Trade with <OrgSelect league={league} value={other.id} onChange={(id) => go('trade', [], { org: id })} />
        <span className="muted small">
          {other.strategy} · {other.stance} · owner {other.owner.type.toLowerCase()} · budget {fmtMoney(other.budget)} · payroll {fmtMoney(otherPay.cbt)}
        </span>
        {shoppingFor(league, other).length > 0 && (
          <span className="needs-tag" title="A buying club pays a little extra (about 10%) for a big-league-ready player at one of these spots">
            Shopping for: <b>{shoppingFor(league, other).join(', ')}</b>
          </span>
        )}
        <button className="btn btn-sm" disabled={!st.give[1].pids.length} title="Have your pro scout file quick reports on the players you'd get in this deal" onClick={() => { setMessage(rushMany(league, st.give[1].pids)); changed(); }}>
          Rush scouting reports ({st.give[1].pids.length})
        </button>
      </div>
      <div className="cards" style={{ alignItems: 'stretch' }}>
        <div className="box" style={{ flex: 1, minWidth: 420 }}>
          <h3>You give</h3>
          <AssetTable league={league} orgId={user.id} assets={st.give[0]} onToggle={(pid) => toggle(0, pid)} />
          <Extras league={league} orgId={user.id} assets={st.give[0]} set={(a) => { st.give[0] = a; refresh(); }} />
        </div>
        <div className="box" style={{ flex: 1, minWidth: 420 }}>
          <h3>You get</h3>
          <AssetTable league={league} orgId={other.id} assets={st.give[1]} onToggle={(pid) => toggle(1, pid)} />
          <Extras league={league} orgId={other.id} assets={st.give[1]} set={(a) => { st.give[1] = a; refresh(); }} />
        </div>
      </div>
      {!empty && (
        <div className="trade-bar">
          <div className="small"><b>You send</b> {summary(league, st.give[0])} · <b>You get</b> {summary(league, st.give[1])}{read && <> · <span className={read.theirsTone}>AGM: {read.theirs}</span></>}</div>
          <div className="form-row" style={{ margin: 0 }}>
            <button className="btn btn-sm btn-primary" disabled={!!err} onClick={() => void propose()}>Send offer</button>
            <button className="btn btn-sm" disabled={!!window} onClick={balance}>Ask your assistant GM</button>
          </div>
        </div>
      )}
      <h2>Summary</h2>
      <div className="kv" style={{ maxWidth: 900 }}>
        <div>You send</div><div>{summary(league, st.give[0])}</div>
        <div>You receive</div><div>{summary(league, st.give[1])}</div>
        <div>Your payroll</div><div>{fmtMoney(userPay.cbt)} → {fmtMoney(userPay.cbt + dUser)} (budget {fmtMoney(user.budget)})</div>
        <div>Their payroll</div><div>{fmtMoney(otherPay.cbt)} → {fmtMoney(otherPay.cbt + dOther)}</div>
        <div>40-man after</div><div>You {fortyMan(league, user.id).length + in40(0)} · them {fortyMan(league, other.id).length + in40(1)}</div>
        <div>Your AGM: would we?</div><div className={read?.mineTone}>{read ? read.mine : '-'}</div>
        <div>Your AGM: will they?</div><div className={read?.theirsTone}>{read ? read.theirs : '-'}</div>
      </div>
      {!empty && !err && (() => { const n = correspondingMoves(league, prop); return n ? <p className="small warn-text" style={{ marginTop: 6 }}>{n} You can still send it; you'll make the corresponding moves when it goes through{league.orgs[league.userOrgId].agm.roster ? ' (your assistant GM handles them)' : ''}.</p> : null; })()}
      {withThem.length > 0 && <div className="alert" style={{ marginTop: 8 }}>{withThem.map((t) => <div key={t.id}>{talkLine(league, t)}</div>)} Sending a new offer replaces it.</div>}
      {err && !empty && <div className="alert alert-err" style={{ marginTop: 8 }}>{err}</div>}
      <div className="form-row">
        <button className="btn btn-primary" disabled={!!err} onClick={() => void propose()}>Send offer</button>
        <button className="btn" disabled={!!window || empty} onClick={balance} title="His best guess at what would get it done">Ask your assistant GM</button>
        <button className="btn" onClick={() => { saved = { other: other.id, give: [emptyAssets(), emptyAssets()] }; refresh(); }}>Clear</button>
      </div>
      {talks.length > 0 && (
        <>
          <h2>Your open offers</h2>
          <table className="data compact">
            <thead><tr><th className="l">Team</th><th className="l">Offer</th><th className="l">Status</th><th /></tr></thead>
            <tbody>
              {talks.map((t) => (
                <tr key={t.id}>
                  <td className="l">{league.orgs[t.orgId].abbrev}</td>
                  <td className="l small">{summary(league, t.proposal.give[0])} for {summary(league, t.proposal.give[1])}</td>
                  <td className="l small">{talkLine(league, t)}</td>
                  <td className="nowrap">
                    {t.status === 'countered' && <a className="btn btn-sm" href={href('inbox')}>See counter</a>}{' '}
                    <button className="btn btn-sm" onClick={() => { withdrawOffer(league, t.id); changed(); }}>Withdraw</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <p className="muted small">
        Offers go to the other club's front office, which answers in a day or two (within the day on deadline day): they accept (the trade goes through), decline, or counter in your Inbox. After about three rounds without a deal, or a lowball, they stop taking your calls for a while.{' '}
        Rules: no trades after the deadline (Jul 31) or during the playoffs. Free agents signed this winter can't be traded until June 15, and this year's draftees until after the World Series. Cash is limited to the remaining salary of the players you send plus $1M. International pool money trades in $250k increments during the signing period (a team can add up to 60% of its pool). Competitive Balance picks are the only tradable draft picks. Players with 10-and-5 rights can veto. Anyone acquired after Aug 31 can't play in the postseason.
      </p>
    </>
  );
}


function talkLine(league: League, t: TradeTalk): string {
  const name = league.orgs[t.orgId].abbrev;
  if (t.status === 'waiting') {
    const d = t.respondDay - league.day;
    return `Waiting on ${name}: answer ${d <= 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`}.`;
  }
  const d = (t.counterExpires ?? league.day) - league.day;
  return `${name} countered: their counter expires ${d <= 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`}.`;
}
