import { useState } from 'react';
import { useStore, changed, setMessage, askConfirm } from '../../store.ts';
import { go, href, useRoute } from '../../router.ts';
import type { League, TradeAssets, TradeProposal } from '../../core/types.ts';
import { aiOpinion, balanceForAi, emptyAssets, executeTrade, aiAccepts, playerTradeBlock, validateTrade, hasTenAndFive, tradeWindowOpen } from '../../core/trade.ts';
import { fmtMoney, orgPayroll } from '../../core/contracts.ts';
import { posLabel } from '../../core/rules.ts';
import { scoutedOvr, scoutedPot } from '../../core/ratings.ts';
import { fortyMan, orgPlayers } from '../../core/util.ts';
import { OrgSelect, Rating, StatusTags } from '../components.tsx';
import { seasonFraction } from '../../core/value.ts';

// The trade being built survives page changes.
let saved: { other: number; give: [TradeAssets, TradeAssets] } | null = null;
let lastQuery = '';

const LEVEL_ORDER = ['MLB', 'AAA', 'AA', 'A+', 'A', 'CPX', 'DSL'];

function AssetTable({ league, orgId, assets, onToggle }: { league: League; orgId: number; assets: TradeAssets; onToggle: (pid: number) => void }) {
  const [lvl, setLvl] = useState('40');
  const ps = orgPlayers(league, orgId)
    .filter((p) => (lvl === '40' ? p.on40 : lvl === 'all' ? true : p.level === lvl))
    .sort((a, b) => LEVEL_ORDER.indexOf(a.level ?? 'AAA') - LEVEL_ORDER.indexOf(b.level ?? 'AAA') || scoutedOvr(league, b) - scoutedOvr(league, a));
  return (
    <>
      <div className="btn-group tabs">
        {['40', 'MLB', 'AAA', 'AA', 'A+', 'A', 'CPX', 'DSL', 'all'].map((l) => (
          <button key={l} className={`btn btn-sm${lvl === l ? ' active' : ''}`} onClick={() => setLvl(l)}>
            {l === '40' ? '40-man' : l === 'all' ? 'All' : l}
          </button>
        ))}
      </div>
      <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
        <table className="data compact">
          <thead>
            <tr><th /><th className="l">Name</th><th>Pos</th><th>Age</th><th>Lvl</th><th>Ovr</th><th>Pot</th><th>Contract</th></tr>
          </thead>
          <tbody>
            {ps.map((p) => {
              const block = playerTradeBlock(league, p);
              return (
                <tr key={p.id} title={block ?? (hasTenAndFive(league, p) ? '10-and-5 rights: can veto a trade' : '')}>
                  <td><input type="checkbox" disabled={!!block} checked={assets.pids.includes(p.id)} onChange={() => onToggle(p.id)} /></td>
                  <td className="l"><a href={href('player', [p.id])}>{p.first} {p.last}</a><StatusTags league={league} p={p} />{hasTenAndFive(league, p) && <span className="tag">10/5</span>}</td>
                  <td>{posLabel(p)}</td>
                  <td>{league.season - p.born}</td>
                  <td>{p.level}</td>
                  <td><Rating v={scoutedOvr(league, p)} /></td>
                  <td><Rating v={scoutedPot(league, p)} /></td>
                  <td>{p.contract.type === 'ML' ? `${fmtMoney(p.contract.salary)} → ${p.contract.exp}` : 'MiLB'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Extras({ league, orgId, assets, set }: { league: League; orgId: number; assets: TradeAssets; set: (a: TradeAssets) => void }) {
  const picks = league.cbPicks.filter((c) => c.orgId === orgId);
  const poolLeft = (league.intl.pools[orgId] ?? 0) - (league.intl.spent[orgId] ?? 0);
  return (
    <div className="form-row">
      Cash $<input type="number" step="0.25" min={0} style={{ width: 70 }} value={assets.cash / 1e6} onChange={(e) => set({ ...assets, cash: Math.max(0, Math.round(Number(e.target.value) * 4) / 4) * 1e6 })} />M
      {league.intl.open && (
        <>
          {' '}· Intl pool $<input type="number" step="0.25" min={0} style={{ width: 70 }} value={assets.pool / 1e6} onChange={(e) => set({ ...assets, pool: Math.max(0, Math.round(Number(e.target.value) * 4) / 4) * 1e6 })} />M <span className="muted small">({fmtMoney(poolLeft)} left)</span>
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
  const opinion = !empty ? aiOpinion(league, other, prop) : '';
  const window = tradeWindowOpen(league);
  const userPay = orgPayroll(league, user);
  const otherPay = orgPayroll(league, other);
  const dUser = salaryOf(league, st.give[1]) - salaryOf(league, st.give[0]);
  const dOther = -dUser;
  const in40 = (i: number) => st.give[1 - i].pids.filter((id) => league.players[id]?.on40).length - st.give[i].pids.filter((id) => league.players[id]?.on40).length;

  const propose = async () => {
    if (err) return setMessage(err);
    if (!aiAccepts(league, other, prop)) {
      setMessage(`The ${other.affiliates.MLB.name} turned it down. ${aiOpinion(league, other, prop)}`);
      return;
    }
    if (!(await askConfirm(`Trade ${summary(league, st.give[0])} for ${summary(league, st.give[1])}?`))) return;
    const e = executeTrade(league, prop);
    if (e) setMessage(e);
    else {
      setMessage(`Trade completed with the ${other.affiliates.MLB.name}.`);
      saved = { other: other.id, give: [emptyAssets(), emptyAssets()] };
    }
    changed();
  };

  const balance = () => {
    const b = balanceForAi(league, prop);
    if (!b) return setMessage(`The ${other.affiliates.MLB.name} don't see a way to make this work.`);
    st.give = b.give;
    setMessage(`The ${other.affiliates.MLB.name} would do it if you add: ${summary(league, { ...emptyAssets(), pids: b.give[0].pids.filter((id) => !prop.give[0].pids.includes(id)) })}.`);
    refresh();
  };

  return (
    <>
      <h1>Trade</h1>
      {window && <div className="alert alert-warn">{window}.</div>}
      <div className="form-row">
        Trade with <OrgSelect league={league} value={other.id} onChange={(id) => go('trade', [], { org: id })} />
        <span className="muted small">
          {other.strategy} · owner {other.owner.type.toLowerCase()} · budget {fmtMoney(other.budget)} · payroll {fmtMoney(otherPay.cbt)}
        </span>
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
      <h2>Summary</h2>
      <div className="kv" style={{ maxWidth: 900 }}>
        <div>You send</div><div>{summary(league, st.give[0])}</div>
        <div>You receive</div><div>{summary(league, st.give[1])}</div>
        <div>Your payroll</div><div>{fmtMoney(userPay.cbt)} → {fmtMoney(userPay.cbt + dUser)} (budget {fmtMoney(user.budget)})</div>
        <div>Their payroll</div><div>{fmtMoney(otherPay.cbt)} → {fmtMoney(otherPay.cbt + dOther)}</div>
        <div>40-man after</div><div>You {fortyMan(league, user.id).length + in40(0)} · them {fortyMan(league, other.id).length + in40(1)}</div>
        <div>{other.abbrev} GM</div><div>{empty ? '-' : opinion}</div>
      </div>
      {err && !empty && <div className="alert alert-err" style={{ marginTop: 8 }}>{err}</div>}
      <div className="form-row">
        <button className="btn btn-primary" disabled={!!err} onClick={() => void propose()}>Propose trade</button>
        <button className="btn" disabled={!!window || empty} onClick={balance}>What would make this work?</button>
        <button className="btn" onClick={() => { saved = { other: other.id, give: [emptyAssets(), emptyAssets()] }; refresh(); }}>Clear</button>
      </div>
      <p className="muted small">
        Rules: no trades after the deadline (Jul 31) or during the playoffs. Free agents signed this winter can't be traded until June 15, and this year's draftees until after the World Series. Cash is limited to the remaining salary of the players you send plus $1M. International pool money trades in $250k increments during the signing period (a team can add up to 60% of its pool). Competitive Balance picks are the only tradable draft picks. Players with 10-and-5 rights can veto. Anyone acquired after Aug 31 can't play in the postseason.
      </p>
    </>
  );
}

