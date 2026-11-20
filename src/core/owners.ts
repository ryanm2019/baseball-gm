// Owners, payroll budgets and team strategy (contend / retool / rebuild).
import type { League, Org, Owner, OwnerType, Strategy } from './types.ts';
import { randomStaffName } from './names.ts';
import { clamp, rand, weightedChoice } from './random.ts';
import { isPitcher, ovr } from './ratings.ts';
import { addNews, orgPlayers } from './util.ts';
import { cbtTax, orgPayroll } from './contracts.ts';

const OWNER_MULT: Record<OwnerType, number> = { Cheap: 0.75, Moderate: 1, 'Big spender': 1.3, 'Win-now': 1.12 };

export function makeOwner(season: number): Owner {
  const { first, last } = randomStaffName();
  const type = weightedChoice<OwnerType>(['Cheap', 'Moderate', 'Big spender', 'Win-now'], [25, 40, 15, 20]);
  return { first, last, type, since: season, patience: 60 };
}

export function baseBudget(org: Org): number {
  return 40e6 + Math.pow(org.market, 1.5) * 170e6;
}

export function computeBudget(org: Org): number {
  let b = baseBudget(org) * OWNER_MULT[org.owner.type];
  if (org.owner.type === 'Win-now' && org.strategy === 'Contend') b *= 1.08;
  if (org.strategy === 'Rebuild') b *= 0.85;
  return Math.round(b / 1e6) * 1e6;
}

// Revenue-sharing recipients are the smallest markets. Tax payors are clubs
// that were over the CBT threshold in the most recently completed season.
export type RevenueStatus = 'payor' | 'recipient' | 'neutral';

export function lastCompletedSeason(league: League): number {
  return league.phase === 'offseason' ? league.season : league.season - 1;
}

export function revenueStatus(league: League, orgId: number): RevenueStatus {
  const rec = league.cbtHistory.find((r) => r.orgId === orgId && r.season === lastCompletedSeason(league));
  if (rec && rec.cbt > league.settings.cbtThreshold) return 'payor';
  return league.orgs[orgId].market < 0.8 ? 'recipient' : 'neutral';
}

export function cbtOverLastSeason(league: League, orgId: number): number {
  const rec = league.cbtHistory.find((r) => r.orgId === orgId && r.season === lastCompletedSeason(league));
  return rec ? rec.cbt - league.settings.cbtThreshold : -Infinity;
}

// Roster strength from the best 26 players in the organization's 40-man/MLB group.
export function teamStrength(league: League, orgId: number): number {
  const ps = orgPlayers(league, orgId).filter((p) => (p.on40 || p.level === 'MLB') && !p.retired);
  const hit = ps.filter((p) => !isPitcher(p)).map(ovr).sort((a, b) => b - a).slice(0, 13);
  const pit = ps.filter(isPitcher).map(ovr).sort((a, b) => b - a).slice(0, 13);
  return [...hit, ...pit].reduce((t, x) => t + x, 0) / 26;
}

export function updateStrategies(league: League, midseason = false): void {
  const ranks = league.orgs.map((o) => ({ o, s: teamStrength(league, o.id) })).sort((a, b) => b.s - a.s);
  const st = league.standings.MLB;
  ranks.forEach(({ o }, i) => {
    let strat: Strategy = i < 10 ? 'Contend' : i >= 21 ? 'Rebuild' : 'Retool';
    if (midseason) {
      // At the deadline the standings matter most.
      const sameLeague = league.orgs.filter((x) => x.league === o.league).map((x) => st[x.id].w - st[x.id].l).sort((a, b) => b - a);
      const cut = sameLeague[5] ?? 0; // sixth playoff spot
      const gb = (cut - (st[o.id].w - st[o.id].l)) / 2;
      strat = gb <= 3 ? 'Contend' : gb >= 9 ? 'Rebuild' : 'Retool';
    }
    if (o.owner.type === 'Win-now' && strat === 'Rebuild' && !midseason) strat = 'Retool';
    if (o.owner.type === 'Win-now' && strat === 'Retool' && i < 16) strat = 'Contend';
    if (o.owner.type === 'Cheap' && strat === 'Retool' && i >= 17) strat = 'Rebuild';
    o.strategy = strat;
  });
}

export function setBudgets(league: League): void {
  for (const o of league.orgs) o.budget = computeBudget(o);
}

// Each winter a few clubs are sold; new owners bring new spending habits.
export function ownerSales(league: League): void {
  for (const o of league.orgs) {
    if (rand() > 0.04) continue;
    const prev = o.owner;
    o.owner = makeOwner(league.season);
    addNews(league, o.id, `The ${o.affiliates.MLB.name} were sold. New owner ${o.owner.first} ${o.owner.last} (${o.owner.type.toLowerCase()}) replaces ${prev.first} ${prev.last}.`);
  }
}

// Owner patience with the user, updated at the end of each season.
export function reviewGm(league: League): void {
  const org = league.orgs[league.userOrgId];
  const ranks = league.orgs.map((o) => ({ id: o.id, s: teamStrength(league, o.id) })).sort((a, b) => b.s - a.s);
  const rank = ranks.findIndex((r) => r.id === org.id);
  const expected = 0.6 - (0.2 * rank) / 29;
  const r = league.standings.MLB[org.id];
  const pct = r.w / Math.max(1, r.w + r.l);
  const po = league.playoffs;
  const madePlayoffs = !!po && [...po.seeds.AL, ...po.seeds.NL].includes(org.id);
  const champ = po?.champion === org.id;
  const resultsW = org.owner.type === 'Win-now' ? 1.5 : 1;
  const moneyW = org.owner.type === 'Cheap' ? 1.6 : org.owner.type === 'Big spender' ? 0.5 : 1;
  let delta = (pct - expected) * 200 * resultsW + (madePlayoffs ? 8 : 0) + (champ ? 20 : 0);
  const pay = orgPayroll(league, org);
  const over = pay.cbt - org.budget;
  if (over > 0) delta -= (over / org.budget) * 70 * moneyW;
  const tax = cbtTax(pay.cbt, org.cbtPayerYears, league.settings).tax;
  if (tax > 0 && org.owner.type !== 'Big spender') delta -= (tax / 1e6) * 0.6 * moneyW;
  const before = org.owner.patience;
  org.owner.patience = clamp(Math.round(before + delta), 0, 100);
  const mood = org.owner.patience >= 70 ? 'thrilled' : org.owner.patience >= 45 ? 'satisfied' : org.owner.patience >= 20 ? 'concerned' : 'out of patience';
  addNews(league, org.id, `Owner review: ${org.owner.first} ${org.owner.last} is ${mood} (job security ${org.owner.patience}/100, ${delta >= 0 ? '+' : ''}${Math.round(delta)}).`);
  if (org.owner.patience <= 0) {
    league.fired = true;
    addNews(league, org.id, `You have been fired as GM of the ${org.affiliates.MLB.name}.`);
  }
}
