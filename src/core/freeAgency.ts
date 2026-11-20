// Free agency with competing offers. Players ask for a contract; AI clubs make
// offers based on need and budget; you can bid too. Each player decides on his
// own timeline, weighing money, years, the team's chances and loyalty.
import type { FaOffer, League, Org, Player } from './types.ts';
import { clamp, rand, randInt } from './random.ts';
import { isPitcher, ovr } from './ratings.ts';
import { marketValue, roundSalary } from './contracts.ts';
import { addNews, addTransaction, fortyMan, orgPlayers, pname, touchRosters } from './util.ts';
import { posLabel } from './rules.ts';
import { revenueStatus } from './owners.ts';
import { normalizeAdjust } from './draft.ts';

// Signing a player who declined a qualifying offer costs picks (and pool money)
// based on the signing club's status; his old club gets a compensation pick.
export function applyQoPenalty(league: League, signer: number, former: number, total: number): void {
  const adj = normalizeAdjust(league.draftAdjust);
  const status = revenueStatus(league, signer);
  const rounds = status === 'payor' ? [2, 5] : status === 'recipient' ? [3] : [2];
  for (let r of rounds) {
    while (adj.forfeit.some((f) => f.orgId === signer && f.round === r)) r++;
    adj.forfeit.push({ orgId: signer, round: r });
  }
  const pool = status === 'payor' ? 1_000_000 : status === 'neutral' ? 500_000 : 0;
  if (pool) league.ifaPenalty[signer] = (league.ifaPenalty[signer] ?? 0) + pool;
  const fStatus = revenueStatus(league, former);
  const after = fStatus === 'payor' ? 'R4' : fStatus === 'recipient' && total >= 50e6 ? 'R1' : 'CBB';
  adj.comp.push({ orgId: former, after });
  league.draftAdjust = adj;
  const lost = rounds.map((r) => `round ${r}`).join(' and ');
  addNews(league, signer, `The ${league.orgs[signer].affiliates.MLB.name} forfeit their ${lost} pick${pool ? ` and $${pool / 1e6}M of international pool money` : ''} for signing a qualifying-offer free agent. The ${league.orgs[former].affiliates.MLB.name} get a compensation pick.`);
}

export const isFreeAgent = (p: Player) => p.orgId === null && !p.retired && !p.prospect && !p.ifa;

// The season a newly signed contract starts.
export const firstContractSeason = (league: League) => (league.phase === 'offseason' ? league.season + 1 : league.season);

export function askingFor(league: League, p: Player): { years: number; aav: number } {
  const s = league.settings;
  const mv = marketValue(p, s);
  const age = firstContractSeason(league) - p.born;
  const greed = 1 + ((p.personality.greed - 50) / 30) * 0.08;
  const aav = roundSalary(Math.max(s.minSalary, mv * greed * (0.97 + rand() * 0.1)));
  const o = ovr(p);
  let years = 1;
  if (o >= 60) years = age <= 28 ? 6 : age <= 30 ? 5 : age <= 32 ? 3 : 2;
  else if (o >= 54) years = age <= 29 ? 4 : age <= 32 ? 2 : 1;
  else if (o >= 49) years = age <= 31 ? 2 : 1;
  if (aav < 2.5e6) years = 1;
  years = clamp(years + (rand() < 0.3 ? 1 : 0) - (rand() < 0.2 ? 1 : 0), 1, 8);
  return { years, aav };
}

// Players who would only get minor league deals.
export const isMinorFA = (league: League, p: Player) => !p.fa || p.fa.asking.aav <= league.settings.minSalary * 1.15 || ovr(p) < 42;

export function openFreeAgent(league: League, p: Player, formerOrg: number | null, qo = false): void {
  const asking = askingFor(league, p);
  const big = asking.aav > 20e6 ? randInt(20, 45) : asking.aav > 8e6 ? randInt(10, 32) : randInt(3, 20);
  p.orgId = null;
  touchRosters();
  p.level = null;
  p.on40 = false;
  p.il = null;
  p.dfa = null;
  p.waivers = null;
  p.optionedOnDay = null;
  p.arb = null;
  p.fa = { opened: league.day, decideDay: league.day + big, asking, offers: [], formerOrg, qo };
}

export function payrollTarget(org: Org): number {
  return org.budget || 40e6 + Math.pow(org.market, 1.5) * 170e6;
}

// Salary already committed for a season (guaranteed contracts plus arbitration cases).
export function committed(league: League, orgId: number, season: number): number {
  let t = 0;
  for (const p of orgPlayers(league, orgId)) {
    if (p.contract.type !== 'ML') continue;
    if (p.contract.exp >= season) t += p.contract.oneWay ? p.contract.salary : league.settings.minSalary;
    else if (p.arb) t += p.arb.settled ?? p.arb.projected;
  }
  for (const d of league.orgs[orgId].deadMoney) if (d.season === season) t += d.amount;
  return t;
}

// Per-day cache of each club's 40-man depth by position (sorted overalls).
type Depth = Map<string, number[]>;

function buildDepth(league: League): Map<number, Depth> {
  const out = new Map<number, Depth>();
  for (const p of Object.values(league.players)) {
    if (p.orgId === null || !p.on40 || p.retired) continue;
    let d = out.get(p.orgId);
    if (!d) out.set(p.orgId, (d = new Map()));
    const arr = d.get(p.pos);
    if (arr) arr.push(ovr(p));
    else d.set(p.pos, [ovr(p)]);
  }
  for (const d of out.values()) for (const arr of d.values()) arr.sort((a, b) => b - a);
  return out;
}

// The player he'd replace: a starter for expensive free agents, a bench or
// depth arm for cheap ones.
function incumbent(depth: Map<number, Depth>, orgId: number, p: Player, cheap: boolean): number {
  const same = depth.get(orgId)?.get(p.pos) ?? [];
  if (isPitcher(p)) return same[p.pos === 'SP' ? (cheap ? 5 : 4) : cheap ? 7 : 6] ?? 35;
  return same[cheap ? 1 : 0] ?? 35;
}

function teamWinPct(league: League, orgId: number): number {
  const r = league.standings.MLB[orgId];
  const g = r.w + r.l;
  if (g > 20) return r.w / g;
  const last = league.lastStandings;
  if (last) return 0.4 + (0.2 * last.indexOf(orgId)) / Math.max(1, last.length - 1);
  return 0.5;
}

// How attractive an offer is to the player, relative to his asking contract (1.0 = exactly what he asked).
export function offerScore(league: League, p: Player, o: FaOffer): number {
  const fa = p.fa!;
  const askMoney = fa.asking.aav * Math.pow(fa.asking.years, 0.9);
  const years = Math.min(o.years, fa.asking.years + 1);
  let score = (o.aav * Math.pow(years, 0.9)) / askMoney;
  const greed = 1 + (p.personality.greed - 50) / 60;
  score = Math.pow(score, greed);
  const win = (p.personality.winning - 50) / 30;
  score *= 1 + win * 0.1 * (teamWinPct(league, o.orgId) - 0.5) * 4;
  if (fa.formerOrg === o.orgId) score *= 1 + 0.02 + ((p.personality.loyalty - 50) / 30) * 0.05;
  return score;
}

export function interestLabel(score: number): string {
  if (score >= 1.05) return 'Very interested';
  if (score >= 0.95) return 'Interested';
  if (score >= 0.85) return 'Considering it';
  return 'Not interested yet';
}

export function makeOffer(league: League, p: Player, orgId: number, years: number, aav: number): string | null {
  if (!p.fa) return 'Not a free agent';
  if (aav < league.settings.minSalary) return `Below the MLB minimum`;
  if (years < 1 || years > 10) return 'Contract length must be 1-10 years';
  if (fortyMan(league, orgId).length >= league.settings.fortyMax) return '40-man roster is full';
  p.fa.offers = p.fa.offers.filter((o) => o.orgId !== orgId);
  p.fa.offers.push({ orgId, years, aav: roundSalary(aav), day: league.day });
  return null;
}

export function withdrawOffer(p: Player, orgId: number): void {
  if (p.fa) p.fa.offers = p.fa.offers.filter((o) => o.orgId !== orgId);
}

export function signFreeAgentOffer(league: League, p: Player, o: FaOffer): void {
  const start = firstContractSeason(league);
  const fa = p.fa!;
  p.orgId = o.orgId;
  touchRosters();
  p.on40 = true;
  const active = orgPlayers(league, o.orgId).filter((q) => q.level === 'MLB' && !q.il).length;
  p.level = league.phase === 'regular' && active >= league.settings.activeMax ? 'AAA' : 'MLB';
  p.contract = { type: 'ML', salary: o.aav, minorSalary: 0, exp: start + o.years - 1, oneWay: true, signed: start };
  p.fa = null;
  p.teamSince = start;
  p.faSigned = start;
  p.joined = { season: league.season, day: league.day };
  if (fa.qo && fa.formerOrg !== null && fa.formerOrg !== o.orgId) applyQoPenalty(league, o.orgId, fa.formerOrg, o.aav * o.years);
  const org = league.orgs[o.orgId];
  const yrs = o.years === 1 ? '1 year' : `${o.years} years`;
  addTransaction(league, o.orgId, 'Sign', `Signed free agent ${posLabel(p)} ${pname(p)}: ${yrs}, $${(o.aav / 1e6).toFixed(2)}M per year`, [p.id]);
  if (o.aav >= 10e6 || o.orgId === league.userOrgId || fa.formerOrg === league.userOrgId) {
    addNews(league, o.orgId, `${pname(p)} signed with the ${org.affiliates.MLB.name}: ${yrs}, $${((o.aav * o.years) / 1e6).toFixed(1)}M total.`, [p.id]);
  }
}

// One day of the market.
export function faDay(league: League): void {
  const offseasonPhase = league.phase === 'offseason' || league.phase === 'preseason';
  // In season the market is thin; check it every few days.
  if (!offseasonPhase && league.day % 3 !== 0) return;
  const fas = Object.values(league.players).filter((p) => p.fa && isFreeAgent(p) && !isMinorFA(league, p));
  if (!fas.length) return;
  const depth = buildDepth(league);
  const fortyCount = new Map<number, number>();
  for (const [orgId, d] of depth) {
    let n = 0;
    for (const arr of d.values()) n += arr.length;
    fortyCount.set(orgId, n);
  }
  const nextSeason = firstContractSeason(league);
  const offseason = offseasonPhase;

  // AI offers
  const ranked = [...fas].sort((a, b) => ovr(b) - ovr(a)).slice(0, 80);
  for (const org of league.orgs) {
    if (org.id === league.userOrgId) continue;
    if (rand() > (offseason ? 0.35 : 0.2)) continue;
    if ((fortyCount.get(org.id) ?? 0) >= league.settings.fortyMax) continue;
    let budget = payrollTarget(org) * (0.92 + rand() * 0.16) - committed(league, org.id, nextSeason);
    let made = 0;
    for (const p of ranked) {
      if (made >= 3 || budget <= 0) break;
      if (p.fa!.offers.some((o) => o.orgId === org.id)) continue;
      const ageNext = nextSeason - p.born;
      if (org.strategy === 'Rebuild' && (ageNext >= 30 || p.fa!.asking.years > 2) && p.fa!.asking.aav > 5e6) continue;
      const cheap = p.fa!.asking.aav <= 4e6;
      const need = ovr(p) - incumbent(depth, org.id, p, cheap);
      if (need < (cheap ? 0.5 : 1.5)) continue;
      const mv = marketValue(p, league.settings);
      const eager = org.strategy === 'Contend' ? 1.08 : org.strategy === 'Rebuild' ? 0.95 : 1;
      const aav = roundSalary(Math.min(mv * 1.15 * eager, p.fa!.asking.aav * (0.86 + rand() * 0.22) * eager));
      if (aav > budget) continue;
      const years = clamp(p.fa!.asking.years + (rand() < 0.3 ? -1 : 0) + (rand() < 0.15 ? 1 : 0), 1, 8);
      p.fa!.offers.push({ orgId: org.id, years, aav, day: league.day });
      budget -= aav;
      made++;
    }
  }

  // Decisions
  for (const p of fas) {
    const fa = p.fa!;
    const valid = fa.offers.filter((o) => (fortyCount.get(o.orgId) ?? 0) < league.settings.fortyMax);
    const scored = valid.map((o) => ({ o, s: offerScore(league, p, o) })).sort((a, b) => b.s - a.s);
    const best = scored[0];
    const due = league.day >= fa.decideDay;
    const early = best && best.s >= 1.12 && rand() < 0.25;
    if (!due && !early) continue;
    if (best && best.s >= 0.85) {
      signFreeAgentOffer(league, p, best.o);
      fortyCount.set(best.o.orgId, (fortyCount.get(best.o.orgId) ?? 0) + 1);
      continue;
    }
    if (due) {
      // No acceptable offer: lower the asking price and wait a bit longer.
      fa.asking.aav = roundSalary(Math.max(league.settings.minSalary, fa.asking.aav * 0.92));
      if (fa.asking.years > 1 && rand() < 0.3) fa.asking.years--;
      fa.decideDay = league.day + randInt(5, 10);
      fa.offers = fa.offers.filter((o) => league.day - o.day < 30);
    }
  }
}
