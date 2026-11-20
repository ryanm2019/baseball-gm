// Contract extensions.
//
// Each season the deal would cover is priced by what he'd otherwise earn:
// pre-arb years near the minimum, arbitration years at projected awards, free
// agent years at projected market value (aging included). Players trade some
// of that for security: the earlier in his career, the bigger the discount
// (a 23-year-old with a year of service takes far less per free agent year
// than a player in his walk year). Greed, loyalty and his agent move it.
//
// An extension signed during the arbitration process settles his case (no
// hearing). Some players won't negotiate once the season starts; a few won't
// negotiate at all before free agency.
import type { League, Org, Player } from './types.ts';
import { fmtMoney, marketValue, orgPayroll, roundSalary, serviceYears } from './contracts.ts';
import { ovr, potOvr, scoutFactor } from './ratings.ts';
import { clamp, rand, randInt, seededNormal, shuffle } from './random.ts';
import { firstContractSeason } from './freeAgency.ts';
import { marketOvr } from './war.ts';
import { bookDeferred, buildContract, playerValue, salaryIn, shapeSchedule, type Terms } from './terms.ts';
import { addNews, addTransaction, pname } from './util.ts';
import { logMove, side } from './moves.ts';
import { posLabel } from './rules.ts';

export type YearStatus = 'Pre-arb' | 'Arb 1' | 'Arb 2' | 'Arb 3' | 'Arb 4' | 'FA';

export interface ExtYear { season: number; status: YearStatus; fair: number }

// First season an extension covers: right after his current guaranteed deal
// (or next season, settling a pending arbitration case).
export function extStart(league: League, p: Player): number {
  const next = firstContractSeason(league);
  if (p.arb && p.arb.settled === null) return next;
  return Math.max(next, p.contract.exp + 1);
}

// First season the new contract (including the rest of the current deal) starts.
function contractBase(league: League): number {
  return league.phase === 'offseason' ? league.season + 1 : league.season;
}

function serviceAt(league: League, p: Player, season: number): number {
  const s = serviceYears(p.mlServiceDays, league.settings);
  const nowFull = league.phase === 'offseason' ? Math.floor(s + 1e-6) : Math.floor(s + 1e-6) + (league.phase === 'regular' || league.phase === 'playoffs' ? 1 : 0);
  return nowFull + (season - (league.season + 1));
}

function projOvr(league: League, p: Player, season: number): number {
  const age = season - p.born;
  const now = marketOvr(league, p, ovr(p), 0.5);
  const yrs = season - league.season;
  let o = now;
  if (age <= 27) o += (potOvr(p) - ovr(p)) * Math.min(1, yrs / 4) * 0.6;
  if (age > 31) o -= 1.4 * (age - 31);
  return clamp(o, 25, 80);
}

// What each covered season is worth to him, before any discount.
export function extYears(league: League, p: Player, years: number): ExtYear[] {
  const s = league.settings;
  const start = extStart(league, p);
  const out: ExtYear[] = [];
  for (let i = 0; i < years; i++) {
    const season = start + i;
    const svc = serviceAt(league, p, season);
    const mv = marketValue(p, s, projOvr(league, p, season));
    let status: YearStatus;
    let fair: number;
    if (svc < 3) { status = 'Pre-arb'; fair = s.minSalary * 1.15; }
    else if (svc < 6) {
      const n = svc - 2;
      status = (`Arb ${Math.min(4, n)}`) as YearStatus;
      fair = Math.max(s.minSalary, mv * [0.25, 0.4, 0.55, 0.68][Math.min(3, n - 1)]);
    } else { status = 'FA'; fair = mv; }
    out.push({ season, status, fair: roundSalary(fair) });
  }
  return out;
}

// How much he'll give up for security, by career stage and personality.
export function securityDiscount(league: League, p: Player): { control: number; fa: number } {
  const svc = serviceYears(p.mlServiceDays, league.settings);
  const fa = svc < 1 ? 0.36 : svc < 2 ? 0.3 : svc < 3 ? 0.25 : svc < 4 ? 0.18 : svc < 5 ? 0.12 : svc < 6 ? 0.07 : 0.03;
  const control = svc < 3 ? 0.2 : 0.1;
  const pers = (1 - (p.personality.greed - 50) / 100) * (1 + (p.personality.loyalty - 50) / 150);
  const agent = agentFactor(league, p);
  const mood = 1 + clamp(((p.morale?.value ?? 55) - 55) / 100, -0.3, 0.3);
  return { control: control * pers * agent * mood, fa: fa * pers * agent * mood };
}

// Hook for agents (set by the agents module): <1 for hard-line agents.
export function agentFactor(league: League, p: Player): number {
  const a = p.agent !== undefined ? league.agents?.[p.agent] : undefined;
  return a ? a.discount : 1;
}

// His asking value for a deal of this length (today's dollars, before talks harden).
export function extAsk(league: League, p: Player, years: number): { total: number; byYear: ExtYear[] } {
  const ys = extYears(league, p, years);
  const d = securityDiscount(league, p);
  const stiff = p.ext?.season === league.season ? (p.ext.stiff ?? 1) : 1;
  let total = 0;
  for (const y of ys) total += y.fair * (1 - (y.status === 'FA' ? d.fa : d.control));
  // Long deals deep into his 30s cost a bit extra; very short ones lose the security he's after.
  return { total: roundSalary(total * stiff), byYear: ys };
}

// Will he talk? null = yes, otherwise why not.
export function extRefusal(league: League, p: Player, orgId = league.userOrgId): string | null {
  if (p.orgId !== orgId) return 'Not your player';
  if (p.contract.type !== 'ML' || !p.on40) return 'Only players on the 40-man roster with major league contracts';
  if (p.fa || p.dfa || p.waivers) return 'Not available';
  const inSeason = league.phase === 'regular' || league.phase === 'playoffs';
  const a = p.agent !== undefined ? league.agents?.[p.agent] : undefined;
  const svc = serviceYears(p.mlServiceDays, league.settings);
  // Some players (and some agents' clients) shut talks down at Opening Day.
  const noInSeason = seededNormal(p.scoutSeed, 0, 5150) + (a?.inSeasonBan ?? 0) > 0.65;
  if (inSeason && noInSeason) return "He won't negotiate during the season. Try again in the offseason.";
  // A few will only listen once they reach free agency.
  if (svc >= 4 && p.personality.greed > 68 && seededNormal(p.scoutSeed, 0, 5151) + (a?.toMarket ?? 0) > 0.9) return 'He intends to test free agency and has declined to negotiate.';
  if (extStart(league, p) - contractBase(league) >= 3) return 'He is already signed for three or more seasons';
  const morale = p.morale?.value;
  if (morale !== undefined && morale < 25) return 'He is too unhappy to talk about staying.';
  return null;
}

const accept = (ratio: number) => 1 / (1 + Math.exp(-(ratio - 1) / 0.045));

function offerValue(league: League, p: Player, t: Terms): number {
  const ys = extYears(league, p, t.sched.length);
  const lastMv = ys.length ? ys[ys.length - 1].fair : league.settings.minSalary;
  return playerValue(t, lastMv, { loyalty: p.personality.loyalty, age: extStart(league, p) - p.born });
}

// The meter, as your pro scouts read him.
export function extWillingness(league: League, p: Player, t: Terms, orgId = league.userOrgId): number {
  const ask = extAsk(league, p, t.sched.length).total;
  const f = scoutFactor(league, league.orgs[orgId], 'own');
  const misread = Math.exp(0.08 * f * seededNormal(p.scoutSeed, orgId, 6161));
  return accept(offerValue(league, p, t) / (ask * misread));
}

export function canOfferExt(league: League, p: Player, orgId = league.userOrgId): string | null {
  const r = extRefusal(league, p, orgId);
  if (r) return r;
  const last = p.ext?.season === league.season ? p.ext.lastOffer : undefined;
  if (last !== undefined && league.day - last < 7) return `One offer a week: next offer in ${7 - (league.day - last)} day(s)`;
  return null;
}

export function offerExtension(league: League, p: Player, t: Terms, orgId = league.userOrgId): { ok: boolean; text: string } {
  const why = canOfferExt(league, p, orgId);
  if (why) return { ok: false, text: why };
  if (t.sched.some((x) => x < league.settings.minSalary)) return { ok: false, text: `Every year must pay at least the minimum (${fmtMoney(league.settings.minSalary)})` };
  if (p.ext?.season !== league.season) p.ext = { season: league.season };
  p.ext!.lastOffer = league.day;
  const ask = extAsk(league, p, t.sched.length).total;
  const ratio = offerValue(league, p, t) / ask;
  if (rand() < accept(ratio)) {
    signExtension(league, p, t, orgId);
    return { ok: true, text: `${pname(p)} agreed to an extension.` };
  }
  if (ratio < 0.8) {
    p.ext!.stiff = Math.min(1.2, (p.ext!.stiff ?? 1) * 1.05);
    return { ok: false, text: `${pname(p)}'s agent called the offer insulting. His price went up.` };
  }
  return { ok: false, text: `${pname(p)} turned it down${ratio >= 0.97 ? ', but it was close' : ''}.` };
}

export function signExtension(league: League, p: Player, t: Terms, orgId: number): void {
  const org = league.orgs[orgId];
  const base = contractBase(league);
  const start = extStart(league, p);
  const c = p.contract;
  // The rest of the current deal joins the extension (the CBT AAV covers both).
  const prefix: number[] = [];
  for (let y = base; y < start; y++) prefix.push(salaryIn(c, y) || c.salary);
  const settledArb = !!(p.arb && p.arb.settled === null);
  const all: Terms = { ...t, sched: [...prefix, ...t.sched], optOuts: t.optOuts?.map((i) => i + prefix.length) };
  p.contract = buildContract(all, base, league.season);
  if (league.phase !== 'offseason') p.contract.salary = c.salary; // this season's pay doesn't change mid-year
  bookDeferred(org, p, { ...p.contract, sched: t.sched, exp: p.contract.exp });
  if (settledArb) p.arb = null;
  p.ext = null;
  p.qoReceived = p.qoReceived ?? false;
  const tot = t.sched.reduce((a, b) => a + b, 0);
  const yrs = t.sched.length;
  const text = `${yrs}-year, ${fmtMoney(tot)} extension (${start}-${start + yrs - 1})${settledArb ? ', avoiding arbitration' : ''}`;
  addTransaction(league, orgId, 'Extension', `Signed ${posLabel(p)} ${pname(p)} to a ${text}`, [p.id]);
  logMove(league, 'Extension', [side(orgId, [p.id])], `${org.abbrev} extended ${posLabel(p)} ${pname(p)}: ${text}`, tot);
  addNews(league, orgId === league.userOrgId ? orgId : null, `The ${org.affiliates.MLB.name} signed ${posLabel(p)} ${pname(p)} to a ${text}.`, [p.id]);
  if (p.morale) p.morale.events.push({ season: league.season, day: league.day, delta: settledArb ? 12 : 8, text: settledArb ? 'Extension (skipped arbitration)' : 'Signed an extension' });
}

// Partial no-trade lists are picked by the player: big markets and losing clubs.
export function pickNtcTeams(league: League, p: Player, orgId: number, n: number): number[] {
  return league.orgs
    .filter((o) => o.id !== orgId)
    .map((o) => ({ o, v: o.market * 0.5 + (o.strategy === 'Rebuild' ? 0.6 : 0) + rand() * 0.6 + (p.personality.winning - 50) / 200 }))
    .sort((a, b) => b.v - a.v)
    .slice(0, n)
    .map((x) => x.o.id);
}

// ---------- AI clubs ----------

function aiCandidate(league: League, org: Org, p: Player): boolean {
  if (extRefusal(league, p, org.id)) return false;
  const svc = serviceYears(p.mlServiceDays, league.settings);
  const age = league.season - p.born;
  const o = ovr(p);
  if (p.level !== 'MLB') return false;
  if (svc < 6 && age <= 29 && (o >= 57 || (potOvr(p) >= 63 && o >= 50))) return true;
  // Walk-year regulars a contender wants to keep.
  return svc >= 5 && age <= 33 && o >= 57 && p.contract.exp === (league.phase === 'offseason' ? league.season + 1 : league.season);
}

// Spring training and a little through the season.
export function aiExtensions(league: League): void {
  const spring = league.phase === 'preseason';
  if (!spring && !(league.phase === 'regular' && league.day % 14 === 0)) return;
  if (spring && league.day % 7 !== 0) return;
  for (const org of shuffle(league.orgs.filter((o) => o.id !== league.userOrgId))) {
    if (org.strategy === 'Rebuild' && rand() < 0.6) continue;
    const pay = orgPayroll(league, org).cbt;
    const cands = Object.values(league.players).filter((p) => p.orgId === org.id && aiCandidate(league, org, p));
    for (const p of cands) {
      if (rand() > (spring ? 0.12 : 0.03)) continue;
      const svc = serviceYears(p.mlServiceDays, league.settings);
      const control = Math.max(0, 6 - Math.ceil(svc));
      const years = clamp(control + randInt(svc < 3 ? 1 : 0, 3), 2, 8);
      const ask = extAsk(league, p, years);
      const offer = ask.total * (0.97 + rand() * 0.09);
      const t: Terms = { sched: shapeSchedule(offer, years, svc < 3 ? 'ramp' : 'flat') };
      if (svc < 4 && rand() < 0.35) {
        const last = ask.byYear[ask.byYear.length - 1].fair;
        t.option = { type: 'club', season: 0, salary: roundSalary(last * 0.95), buyout: roundSalary(last * 0.08) };
      }
      const newAav = offer / years;
      if (pay + Math.max(0, newAav - p.contract.salary) > org.budget * 1.04) continue;
      offerExtension(league, p, t, org.id);
    }
  }
}
