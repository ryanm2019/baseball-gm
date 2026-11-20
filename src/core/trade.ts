// Trades: rules, evaluation, AI negotiation, AI-to-AI deals and offers to the user.
import type { League, Org, Player, TradeAssets, TradeOffer, TradeProposal } from './types.ts';
import { isPitcher, ovr } from './ratings.ts';
import { orgPayroll, roundSalary, serviceYears } from './contracts.ts';
import { addNews, addTransaction, fortyMan, orgPlayers, pname, touchRosters } from './util.ts';
import { posLabel } from './rules.ts';
import { CB_VALUE, POOL_VALUE, projectValue, seasonFraction, tradeValue } from './value.ts';
import { delegated } from './staff.ts';
import { rand, shuffle } from './random.ts';
import { dayToDate } from './settings.ts';

export const emptyAssets = (): TradeAssets => ({ pids: [], cash: 0, pool: 0, cbPicks: [] });

const MARGIN: Record<League['settings']['tradeDifficulty'], number> = { Easy: -0.05, Normal: 0.05, Hard: 0.15, Insane: 0.3 };

function june15(league: League): number {
  return Math.round((Date.UTC(league.season, 5, 15) - dayToDate(league.season, 0).getTime()) / 86400000);
}

export function tradeWindowOpen(league: League): string | null {
  if (league.phase === 'playoffs') return 'No trades during the playoffs';
  if (league.phase === 'regular' && league.day > league.settings.tradeDeadlineDay) return 'The trade deadline has passed';
  if (league.phase === 'regular' && league.draft && league.draft.season === league.season && !league.draft.done && league.day === league.settings.draftDay) return 'No trades during the draft';
  return null;
}

export function playerTradeBlock(league: League, p: Player): string | null {
  if (p.retired || p.orgId === null) return 'Not under contract';
  if (p.waivers) return 'On waivers';
  if (p.prospect || p.ifa) return 'Unsigned amateur';
  // Recently drafted players can't be traded until after the World Series.
  if (p.draft && p.draft.year === league.season && (league.phase === 'regular' || league.phase === 'playoffs')) return 'Drafted this year: tradable after the World Series';
  // Free agents signed this winter can't be traded until June 15 of their first season.
  const firstSeason = league.phase === 'regular' ? league.season : league.season + 1;
  if (p.faSigned === firstSeason && (league.phase !== 'regular' || league.day < june15(league))) return 'Signed as a free agent this winter: tradable June 15';
  return null;
}

export const hasTenAndFive = (league: League, p: Player) =>
  serviceYears(p.mlServiceDays, league.settings) >= 10 && league.season - (p.teamSince ?? league.season) >= 5;

function remainingSalary(league: League, pids: number[]): number {
  const f = seasonFraction(league);
  return pids.reduce((t, id) => {
    const p = league.players[id];
    return t + (p && p.contract.type === 'ML' ? p.contract.salary * f : 0);
  }, 0);
}

export function validateTrade(league: League, prop: TradeProposal): string | null {
  const w = tradeWindowOpen(league);
  if (w) return w;
  const [a, b] = prop.orgs;
  if (prop.give[0].pids.length + prop.give[1].pids.length + prop.give[0].cbPicks.length + prop.give[1].cbPicks.length === 0 && !prop.give[0].cash && !prop.give[1].cash && !prop.give[0].pool && !prop.give[1].pool) return 'Nothing in the trade';
  for (let i = 0; i < 2; i++) {
    const org = prop.orgs[i];
    const other = prop.orgs[1 - i];
    const g = prop.give[i];
    for (const id of g.pids) {
      const p = league.players[id];
      if (!p || p.orgId !== org) return 'A player is no longer with that team';
      const why = playerTradeBlock(league, p);
      if (why) return `${pname(p)}: ${why}`;
    }
    if (g.cash < 0 || g.pool < 0) return 'Amounts must be positive';
    const maxCash = remainingSalary(league, g.pids) + 1e6;
    if (g.cash > maxCash) return `Cash can't exceed the remaining salary of players sent plus $1M (${(maxCash / 1e6).toFixed(2)}M)`;
    if (g.pool) {
      if (!league.intl.open) return 'International pool money can only be traded during the signing period';
      if (g.pool % 250_000 !== 0) return 'Pool money trades in $250k increments';
      const left = (league.intl.pools[org] ?? 0) - (league.intl.spent[org] ?? 0);
      if (g.pool > left) return 'Not enough international pool money left';
      const base = league.intl.base?.[other] ?? league.intl.pools[other] ?? 0;
      const acquired = league.intl.acquired?.[other] ?? 0;
      if (acquired + g.pool > base * 0.6) return 'A team can acquire at most 60% of its original pool';
    }
    for (const cid of g.cbPicks) {
      const c = league.cbPicks.find((x) => x.id === cid);
      if (!c || c.orgId !== org) return 'Competitive balance pick not owned';
    }
    // 40-man space after the trade.
    const in40 = prop.give[1 - i].pids.filter((id) => league.players[id]?.on40).length;
    const out40 = g.pids.filter((id) => league.players[id]?.on40).length;
    if (fortyMan(league, org).length + in40 - out40 > league.settings.fortyMax) return `${league.orgs[org].abbrev} would be over 40 on the 40-man roster`;
  }
  void a;
  void b;
  return null;
}

// ---------- evaluation ----------

export interface Evaluation {
  dv: number; // value gained minus value given, from this org's view
  received: number;
  sent: number;
  need: number; // margin required
}

export function evaluate(league: League, org: Org, prop: TradeProposal): Evaluation {
  const i = prop.orgs.indexOf(org.id);
  const give = prop.give[i];
  const get = prop.give[1 - i];
  const recVals = get.pids.map((id) => tradeValue(league, org, league.players[id], true)).sort((x, y) => y - x);
  // Consolidation: a pile of small pieces is worth less than its sum.
  let received = 0;
  let k = 0;
  for (const v of recVals) {
    if (v > 0) received += v * Math.max(0.4, 1 - 0.12 * k++);
    else received += v;
  }
  received += get.cash + get.pool * POOL_VALUE * (org.strategy === 'Rebuild' ? 1.3 : 1);
  for (const cid of get.cbPicks) received += CB_VALUE[league.cbPicks.find((c) => c.id === cid)?.round ?? 'B'];
  let sent = give.pids.reduce((t, id) => t + tradeValue(league, org, league.players[id], false), 0);
  sent += give.cash + give.pool * POOL_VALUE;
  for (const cid of give.cbPicks) sent += CB_VALUE[league.cbPicks.find((c) => c.id === cid)?.round ?? 'B'];
  // Extra 40-man players cost roster flexibility.
  const extra = get.pids.filter((id) => league.players[id].on40).length - give.pids.filter((id) => league.players[id].on40).length;
  if (extra > 0) received -= extra * 1e6;
  // Owners over budget hate adding salary.
  const salaryIn = remainingSalary(league, get.pids) - get.cash;
  const salaryOut = remainingSalary(league, give.pids) - give.cash;
  const payroll = orgPayroll(league, org).cbt;
  if (salaryIn > salaryOut && payroll + salaryIn - salaryOut > org.budget) received -= (salaryIn - salaryOut) * 0.5;
  const human = prop.orgs.includes(league.userOrgId) && org.id !== league.userOrgId;
  const pct = human ? MARGIN[league.settings.tradeDifficulty] : 0.03;
  const need = Math.max(human ? 0.5e6 : 0, Math.abs(sent) * pct + (human ? 0.5e6 : 0));
  return { dv: received - sent, received, sent, need };
}

export function aiAccepts(league: League, org: Org, prop: TradeProposal): boolean {
  const e = evaluate(league, org, prop);
  return e.dv >= e.need;
}

export function aiOpinion(league: League, org: Org, prop: TradeProposal): string {
  const e = evaluate(league, org, prop);
  const gap = e.need - e.dv;
  if (gap <= 0) return e.dv > e.need + 5e6 ? `"We'd do that deal right now."` : `"That works for us."`;
  if (gap < 3e6) return `"Close. Add a little more and we have a deal."`;
  if (gap < 12e6) return `"We need quite a bit more than that."`;
  return `"Not even close."`;
}

// ---------- 10-and-5 vetoes ----------

function vetoes(league: League, prop: TradeProposal): Player | null {
  for (let i = 0; i < 2; i++) {
    const dest = league.orgs[prop.orgs[1 - i]];
    for (const id of prop.give[i].pids) {
      const p = league.players[id];
      if (!hasTenAndFive(league, p)) continue;
      const chance = dest.strategy === 'Contend' && p.personality.winning >= 50 ? 0.2 : 0.55;
      if (rand() < chance) return p;
    }
  }
  return null;
}

// ---------- execution ----------

export function executeTrade(league: League, prop: TradeProposal): string | null {
  const err = validateTrade(league, prop);
  if (err) return err;
  const v = vetoes(league, prop);
  if (v) {
    addNews(league, v.orgId, `${pname(v)} used his 10-and-5 rights to veto a trade to the ${league.orgs[prop.orgs[0] === v.orgId ? prop.orgs[1] : prop.orgs[0]].affiliates.MLB.name}.`, [v.id]);
    return `${pname(v)} used his 10-and-5 rights to veto the trade.`;
  }
  const seasonForCash = league.phase === 'offseason' ? league.season + 1 : league.season;
  const desc: string[] = ['', ''];
  for (let i = 0; i < 2; i++) {
    const from = prop.orgs[i];
    const to = prop.orgs[1 - i];
    const g = prop.give[i];
    const parts: string[] = [];
    for (const id of g.pids) {
      const p = league.players[id];
      p.orgId = to;
      p.teamSince = league.season;
      p.joined = { season: league.season, day: league.day };
      p.dfa = null;
      if (p.level === null) p.level = 'AAA';
      parts.push(`${posLabel(p)} ${pname(p)}`);
    }
    if (g.cash) {
      league.orgs[from].cash.push({ season: seasonForCash, amount: g.cash, note: `to ${league.orgs[to].abbrev}` });
      league.orgs[to].cash.push({ season: seasonForCash, amount: -g.cash, note: `from ${league.orgs[from].abbrev}` });
      parts.push(`$${(g.cash / 1e6).toFixed(2)}M cash`);
    }
    if (g.pool) {
      league.intl.pools[from] -= g.pool;
      league.intl.pools[to] += g.pool;
      league.intl.acquired ??= {};
      league.intl.acquired[to] = (league.intl.acquired[to] ?? 0) + g.pool;
      parts.push(`$${(g.pool / 1e6).toFixed(2)}M international pool money`);
    }
    for (const cid of g.cbPicks) {
      const c = league.cbPicks.find((x) => x.id === cid)!;
      c.orgId = to;
      parts.push(`${c.season} Competitive Balance Round ${c.round} pick`);
    }
    desc[i] = parts.length ? parts.join(', ') : 'nothing';
  }
  touchRosters();
  const [a, b] = prop.orgs;
  const pids = [...prop.give[0].pids, ...prop.give[1].pids];
  addTransaction(league, a, 'Trade', `Traded ${desc[0]} to the ${league.orgs[b].affiliates.MLB.name} for ${desc[1]}`, pids);
  addTransaction(league, b, 'Trade', `Traded ${desc[1]} to the ${league.orgs[a].affiliates.MLB.name} for ${desc[0]}`, pids);
  addNews(league, a, `Trade: the ${league.orgs[a].affiliates.MLB.name} sent ${desc[0]} to the ${league.orgs[b].affiliates.MLB.name} for ${desc[1]}.`, pids);
  league.tradeOffers = league.tradeOffers.filter((o) => !pids.some((id) => o.proposal.give[0].pids.includes(id) || o.proposal.give[1].pids.includes(id)));
  return null;
}

// ---------- AI negotiation helpers ----------

export function tradable(league: League, orgId: number): Player[] {
  return orgPlayers(league, orgId).filter((p) => !playerTradeBlock(league, p) && !p.il);
}

// "What would make this work?": the AI asks for more from the user.
export function balanceForAi(league: League, prop: TradeProposal): TradeProposal | null {
  const aiIdx = prop.orgs[0] === league.userOrgId ? 1 : 0;
  const userIdx = 1 - aiIdx;
  const ai = league.orgs[prop.orgs[aiIdx]];
  const next: TradeProposal = JSON.parse(JSON.stringify(prop));
  for (let step = 0; step < 4; step++) {
    const e = evaluate(league, ai, next);
    const gap = e.need - e.dv;
    if (gap <= 0) return next;
    const cands = tradable(league, prop.orgs[userIdx])
      .filter((p) => !next.give[userIdx].pids.includes(p.id))
      .map((p) => ({ p, v: tradeValue(league, ai, p, true) }))
      .filter((x) => x.v > 0.5e6);
    if (!cands.length) return null;
    cands.sort((x, y) => x.v - y.v);
    // Only consider additions that keep the trade legal (e.g. 40-man space).
    const legal = cands.filter((x) => {
      next.give[userIdx].pids.push(x.p.id);
      const ok = !validateTrade(league, next);
      next.give[userIdx].pids.pop();
      return ok;
    });
    if (!legal.length) return null;
    const enough = legal.find((x) => x.v * 0.95 >= gap);
    const pick = enough ?? legal[legal.length - 1];
    next.give[userIdx].pids.push(pick.p.id);
  }
  return aiAccepts(league, ai, next) ? next : null;
}

// Builds the best package an AI club would give for the user's offered assets.
export function aiCounterFor(league: League, ai: Org, userGive: TradeAssets): TradeProposal | null {
  const prop: TradeProposal = { orgs: [ai.id, league.userOrgId], give: [emptyAssets(), JSON.parse(JSON.stringify(userGive))] };
  const pool = tradable(league, ai.id)
    .map((p) => ({ p, v: tradeValue(league, ai, p, false) }))
    .filter((x) => x.v > 0.3e6)
    .sort((x, y) => y.v - x.v);
  for (const { p } of pool) {
    if (prop.give[0].pids.length >= 4) break;
    prop.give[0].pids.push(p.id);
    if (!aiAccepts(league, ai, prop) || validateTrade(league, prop)) prop.give[0].pids.pop();
  }
  if (!prop.give[0].pids.length || validateTrade(league, prop)) return null;
  return prop;
}

// ---------- AI-to-AI trades ----------

function needFor(league: League, buyer: Org, p: Player): number {
  const same = orgPlayers(league, buyer.id).filter((q) => q.level === 'MLB' && q.pos === p.pos).map(ovr).sort((a, b) => b - a);
  const slot = isPitcher(p) ? (p.pos === 'SP' ? 4 : 6) : 0;
  return ovr(p) - (same[slot] ?? 35);
}

function tryAiTrade(league: League): void {
  const ai = league.orgs.filter((o) => o.id !== league.userOrgId);
  const buyers = shuffle(ai.filter((o) => o.strategy === 'Contend'));
  const sellers = shuffle(ai.filter((o) => o.strategy !== 'Contend'));
  const buyer = buyers[0];
  const seller = sellers[0];
  if (!buyer || !seller) return;
  const targets = tradable(league, seller.id)
    .filter((p) => p.level === 'MLB' && league.season - p.born >= 26 && needFor(league, buyer, p) >= 2)
    .map((p) => ({ p, v: tradeValue(league, buyer, p, true) }))
    .filter((x) => x.v > 1e6)
    .sort((a, b) => b.v - a.v);
  const target = targets[Math.floor(rand() * Math.min(3, targets.length))];
  if (!target) return;
  const prop: TradeProposal = { orgs: [buyer.id, seller.id], give: [emptyAssets(), { ...emptyAssets(), pids: [target.p.id] }] };
  const chips = tradable(league, buyer.id)
    .filter((p) => p.level !== 'MLB')
    .map((p) => ({ p, v: tradeValue(league, seller, p, true) }))
    .filter((x) => x.v > 0.5e6)
    .sort((a, b) => b.v - a.v);
  for (const { p } of chips) {
    if (aiAccepts(league, seller, prop)) break;
    if (prop.give[0].pids.length >= 4) break;
    prop.give[0].pids.push(p.id);
    if (!aiAccepts(league, buyer, prop)) prop.give[0].pids.pop();
  }
  if (!prop.give[0].pids.length) return;
  if (!aiAccepts(league, seller, prop) || !aiAccepts(league, buyer, prop)) return;
  if (validateTrade(league, prop)) return;
  executeTrade(league, prop);
}

// ---------- AI offers to the user ----------

function makeOfferToUser(league: League): void {
  const user = league.orgs[league.userOrgId];
  const ai = shuffle(league.orgs.filter((o) => o.id !== user.id))[0];
  const wants = tradable(league, user.id)
    .map((p) => ({ p, v: tradeValue(league, ai, p, true) }))
    .filter((x) => x.v > 3e6)
    .sort((a, b) => b.v - a.v)
    .slice(0, 8);
  if (!wants.length) return;
  const want = wants[Math.floor(rand() * wants.length)];
  const counter = aiCounterFor(league, ai, { ...emptyAssets(), pids: [want.p.id] });
  if (!counter) return;
  const uv = evaluate(league, user, counter);
  if (uv.dv < -3e6) return; // don't spam lopsided offers
  const offer: TradeOffer = { id: league.nextId.tx++, day: league.day, season: league.season, fromOrg: ai.id, proposal: counter, expires: league.day + 7 };
  if (delegated(league, user, 'trades')) {
    if (uv.dv >= Math.abs(uv.sent) * 0.08 + 1e6) {
      const err = executeTrade(league, counter);
      if (!err) addNews(league, user.id, `Your assistant GM accepted a trade offer from the ${ai.affiliates.MLB.name}.`);
    }
    return;
  }
  league.tradeOffers.push(offer);
  addNews(league, user.id, `The ${ai.affiliates.MLB.name} made you a trade offer for ${pname(want.p)}. See Trade Offers.`, [want.p.id]);
}

export function tradeDay(league: League): void {
  league.tradeOffers = league.tradeOffers.filter((o) => o.expires >= league.day && o.season === league.season && !validateTrade(league, o.proposal));
  if (tradeWindowOpen(league)) return;
  const f = league.settings.aiTradeFactor;
  if (f <= 0) return;
  const nearDeadline = league.phase === 'regular' && league.day >= league.settings.tradeDeadlineDay - 21;
  const base = league.phase === 'regular' ? (nearDeadline ? 1.6 : 0.4) : 0.3;
  for (let k = 0; k < Math.ceil(base * f); k++) if (rand() < (base * f) / Math.ceil(base * f)) tryAiTrade(league);
  if (rand() < (nearDeadline ? 0.25 : 0.08) * Math.min(1.5, f)) makeOfferToUser(league);
}

export function projectedWar(league: League, org: Org, p: Player): number {
  const y = projectValue(league, org, p).years[0];
  return y ? y.war : 0;
}

export { roundSalary };
