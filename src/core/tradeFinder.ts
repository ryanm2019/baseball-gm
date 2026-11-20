// Trade finder. Three modes, all built on the same valuation the AI uses to
// accept or reject trades, so what it finds is what they'll take:
//   - get a player: packages from your organization his team would accept
//   - shop my player: every club's best offer, as prospects, MLB talent, or
//     picks and pool money
//   - fill a need: available players at a position and what each would cost
import type { League, Org, Player, Pos, TradeAssets, TradeProposal } from './types.ts';
import { aiAccepts, emptyAssets, playerTradeBlock, tradable, validateTrade } from './trade.ts';
import { CB_VALUE, POOL_VALUE, tradeValue } from './value.ts';
import { isPitcher, ovr, potOvr } from './ratings.ts';
import { activeAt } from './util.ts';

export type Want = 'best' | 'prospects' | 'mlb' | 'picks';

export interface FinderOpts {
  untouchable: Set<number>;
  allowPicks: boolean; // competitive balance picks and international pool money
  kind?: 'any' | 'prospects' | 'mlb'; // what you're willing to give
}

export interface FoundDeal {
  prop: TradeProposal; // orgs[0] = user, orgs[1] = AI
  costToYou: number; // your valuation of what you give
  valueToYou: number; // your valuation of what you get
  note: string;
}

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

const isProspect = (league: League, p: Player) => p.level !== 'MLB' && league.season - p.born <= 25;

function kindOk(league: League, p: Player, kind: FinderOpts['kind']): boolean {
  if (!kind || kind === 'any') return true;
  return kind === 'prospects' ? isProspect(league, p) : p.level === 'MLB';
}

// Your valuation of an asset bundle.
function bundleValue(league: League, org: Org, a: TradeAssets, receiving: boolean): number {
  let v = a.pids.reduce((t, id) => t + tradeValue(league, org, league.players[id], receiving), 0);
  v += a.cash + a.pool * POOL_VALUE;
  for (const cid of a.cbPicks) v += CB_VALUE[league.cbPicks.find((c) => c.id === cid)?.round ?? 'B'];
  return v;
}

// Pool money (in $250k steps) a club could still send.
function poolLeft(league: League, orgId: number): number {
  if (!league.intl.open) return 0;
  const left = (league.intl.pools[orgId] ?? 0) - (league.intl.spent[orgId] ?? 0);
  return Math.max(0, Math.floor(left / 250_000) * 250_000);
}

// ---------- get a player ----------

export function findPackagesFor(league: League, targetPid: number, opts: FinderOpts, max = 6): FoundDeal[] {
  const target = league.players[targetPid];
  if (!target || target.orgId === null || target.orgId === league.userOrgId) return [];
  if (playerTradeBlock(league, target)) return [];
  const ai = league.orgs[target.orgId];
  const user = league.orgs[league.userOrgId];
  const base: TradeProposal = { orgs: [user.id, ai.id], give: [emptyAssets(), { ...emptyAssets(), pids: [target.id] }] };
  const cands = tradable(league, user.id)
    .filter((p) => !opts.untouchable.has(p.id) && kindOk(league, p, opts.kind))
    .map((p) => ({ p, ai: tradeValue(league, ai, p, true), mine: tradeValue(league, user, p, false) }))
    .filter((x) => x.ai > 0.3e6)
    .sort((a, b) => a.ai - b.ai)
    .slice(-60);
  const out: FoundDeal[] = [];
  const seen = new Set<string>();
  const add = (prop: TradeProposal, note: string) => {
    if (validateTrade(league, prop) || !aiAccepts(league, ai, prop)) return;
    const key = [...prop.give[0].pids].sort().join(',') + '|' + prop.give[0].cbPicks.join(',') + '|' + prop.give[0].pool;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ prop, costToYou: bundleValue(league, user, prop.give[0], false), valueToYou: bundleValue(league, user, prop.give[1], true), note });
  };
  // One piece: the cheapest single players who get it done.
  for (const c of cands) {
    const prop = clone(base);
    prop.give[0].pids = [c.p.id];
    add(prop, 'One-for-one');
    if (out.length >= 3) break;
  }
  // Volume: build up from smaller pieces, several ways.
  const sweeteners = (prop: TradeProposal) => {
    if (!opts.allowPicks) return;
    const cb = league.cbPicks.filter((c) => c.orgId === user.id).map((c) => c.id);
    if (cb.length) prop.give[0].cbPicks = [cb[0]];
    const pool = Math.min(poolLeft(league, user.id), 2_000_000);
    if (pool) prop.give[0].pool = pool;
  };
  for (const variant of [0, 1, 2, 3]) {
    const prop = clone(base);
    if (variant === 3) sweeteners(prop);
    const pool = variant === 1 ? cands.filter((c) => isProspect(league, c.p)) : variant === 2 ? cands.filter((c) => c.p.level === 'MLB') : cands;
    for (let step = 0; step < 4 && !aiAccepts(league, ai, prop); step++) {
      const left = pool.filter((c) => !prop.give[0].pids.includes(c.p.id));
      if (!left.length) break;
      // Smallest piece that closes the gap, else the biggest still available.
      const legal = left.filter((c) => { prop.give[0].pids.push(c.p.id); const ok = !validateTrade(league, prop); prop.give[0].pids.pop(); return ok; });
      if (!legal.length) break;
      const gapClosers = legal.filter((c) => { prop.give[0].pids.push(c.p.id); const ok = aiAccepts(league, ai, prop); prop.give[0].pids.pop(); return ok; });
      const pick = gapClosers[0] ?? legal[legal.length - 1 - Math.min(legal.length - 1, step)];
      prop.give[0].pids.push(pick.p.id);
    }
    add(prop, variant === 1 ? 'Built from prospects' : variant === 2 ? 'Built from MLB players' : variant === 3 ? 'With picks / pool money' : 'Mixed package');
  }
  return out.sort((a, b) => a.costToYou - b.costToYou).slice(0, max);
}

// ---------- shop my player ----------

export function shopPlayer(league: League, pid: number, want: Want): FoundDeal[] {
  const p = league.players[pid];
  const user = league.orgs[league.userOrgId];
  if (!p || p.orgId !== user.id || playerTradeBlock(league, p)) return [];
  const out: FoundDeal[] = [];
  for (const ai of league.orgs) {
    if (ai.id === user.id) continue;
    const prop: TradeProposal = { orgs: [user.id, ai.id], give: [{ ...emptyAssets(), pids: [pid] }, emptyAssets()] };
    if (want === 'picks') {
      for (const c of league.cbPicks.filter((c) => c.orgId === ai.id)) {
        prop.give[1].cbPicks.push(c.id);
        if (!aiAccepts(league, ai, prop) || validateTrade(league, prop)) prop.give[1].cbPicks.pop();
      }
      // Then pool money in $250k steps, as much as they'll part with.
      let step = poolLeft(league, ai.id);
      while (step >= 250_000) {
        prop.give[1].pool += step;
        if (!aiAccepts(league, ai, prop) || validateTrade(league, prop)) prop.give[1].pool -= step;
        step = Math.floor(step / 2 / 250_000) * 250_000;
      }
    } else {
      const pool = tradable(league, ai.id)
        .filter((x) => (want === 'prospects' ? isProspect(league, x) : want === 'mlb' ? x.level === 'MLB' : true))
        .map((x) => ({ x, v: tradeValue(league, ai, x, false) }))
        .filter((y) => y.v > 0.3e6)
        .sort((a, b) => b.v - a.v);
      for (const { x } of pool) {
        if (prop.give[1].pids.length >= 4) break;
        prop.give[1].pids.push(x.id);
        if (!aiAccepts(league, ai, prop) || validateTrade(league, prop)) prop.give[1].pids.pop();
      }
    }
    const g = prop.give[1];
    if (!g.pids.length && !g.cbPicks.length && !g.pool) continue;
    if (validateTrade(league, prop) || !aiAccepts(league, ai, prop)) continue;
    out.push({ prop, costToYou: bundleValue(league, user, prop.give[0], false), valueToYou: bundleValue(league, user, g, true), note: ai.stance });
  }
  return out.sort((a, b) => b.valueToYou - a.valueToYou);
}

// ---------- fill a need ----------

export interface NeedRow { p: Player; deal: FoundDeal | null }

export function fillNeed(league: League, pos: Pos | 'OF' | 'LHP', opts: FinderOpts & { maxSalary: number; mlbOnly: boolean }): NeedRow[] {
  const user = league.orgs[league.userOrgId];
  const matches = (p: Player) =>
    pos === 'OF' ? ['LF', 'CF', 'RF'].includes(p.pos) : pos === 'LHP' ? isPitcher(p) && p.throws === 'L' : p.pos === pos;
  // Only players who'd actually help: better than your current option.
  const mine = activeAt(league, user.id, 'MLB').filter(matches).map(ovr).sort((a, b) => b - a)[0] ?? 0;
  const cands = Object.values(league.players)
    .filter((p) => p.orgId !== null && p.orgId !== user.id && matches(p) && !playerTradeBlock(league, p) && !p.il)
    .filter((p) => (opts.mlbOnly ? p.level === 'MLB' : p.level === 'MLB' || p.level === 'AAA'))
    .filter((p) => p.contract.salary <= opts.maxSalary && Math.max(ovr(p), p.level === 'MLB' ? 0 : potOvr(p) - 6) > mine)
    .sort((a, b) => ovr(b) - ovr(a))
    .slice(0, 14);
  return cands.map((p) => ({ p, deal: findPackagesFor(league, p.id, opts, 1)[0] ?? null }));
}
