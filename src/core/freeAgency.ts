// Free agency with competing offers. Players ask for a contract; AI clubs make
// offers based on need and budget; you can bid too. Each player decides on his
// own timeline, weighing money, years, the team's chances and loyalty.
import type { FaOffer, League, Org, Player } from './types.ts';
import { clamp, rand, randInt, shuffle } from './random.ts';
import { isPitcher, ovr, potOvr } from './ratings.ts';
import { fmtMoney, marketValue, roundSalary, serviceYears, orgPayroll } from './contracts.ts';
import { addNews, addScoop, addTransaction, fortyMan, orgPlayers, pname, touchRosters } from './util.ts';
import { designate, posLabel } from './rules.ts';
import { revenueStatus } from './owners.ts';
import { normalizeAdjust } from './draft.ts';
import { logMove, side } from './moves.ts';
import { deptEffect } from './depts.ts';
import { marketOvr } from './war.ts';
import { postingFee } from './intl.ts';
import { bookDeferred, buildContract, playerValue, shapeSchedule, type Terms } from './terms.ts';
import { addInbox } from './morale.ts';
import { milbBidDay } from './milbFa.ts';
import { makeMlbRoom } from './farmDirector.ts';
import { delegated } from './staff.ts';
import { slotNewcomer } from './depthUpdate.ts';
import { dayShort } from './settings.ts';
import { agentReplies, offerMade, rivalAlert } from './faTalks.ts';

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
  const mv = marketValue(p, s, marketOvr(league, p, ovr(p), 0.4));
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
  // How long he takes is his own business, like real life: a few sign within
  // days, most take weeks, some drag into January. Bigger names lean later.
  // Talks move faster now: his date moves with the market (strong offers pull
  // it in, a bidding war pushes it back a little), so the first date is short.
  const timeline = () => {
    const u = rand();
    const late = asking.aav > 20e6 ? 0.08 : 0;
    return u < 0.2 - late ? randInt(3, 7) : u < 0.65 - late ? randInt(8, 18) : u < 0.92 - late ? randInt(19, 30) : randInt(31, 45);
  };
  const big = asking.aav > 8e6 ? timeline() : randInt(3, 12);
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
    // CBT terms: a scheduled deal counts its AAV, not this year's (maybe back-loaded) salary.
    if (p.contract.exp >= season) t += p.contract.oneWay ? (p.contract.aav ?? p.contract.salary) : league.settings.minSalary;
    else if (p.arb) t += p.arb.settled ?? p.arb.projected;
    // Pre-arb players on the 40-man are renewed at about the minimum.
    else if (p.on40 && serviceYears(p.mlServiceDays, league.settings) < 3) t += league.settings.minSalary * 1.05;
  }
  // Player benefits count against the CBT payroll too.
  t += league.settings.playerBenefits;
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
  // Full terms: options, opt-outs, no-trade and deferrals change what the deal is worth to him.
  const age = firstContractSeason(league) - p.born;
  const per = o.terms ? playerValue(o.terms, fa.asking.aav, { loyalty: p.personality.loyalty, age }) / o.terms.sched.length : o.aav;
  let score = (per * Math.pow(years, 0.9)) / askMoney;
  const greed = 1 + (p.personality.greed - 50) / 60;
  score = Math.pow(score, greed);
  const win = (p.personality.winning - 50) / 30;
  score *= 1 + win * 0.1 * (teamWinPct(league, o.orgId) - 0.5) * 4;
  if (fa.formerOrg === o.orgId) score *= 1 + 0.02 + ((p.personality.loyalty - 50) / 30) * 0.05;
  score *= 1 + 0.06 * deptEffect(league.orgs[o.orgId], 'facilities');
  return score;
}

export function interestLabel(score: number): string {
  if (score >= 1.05) return 'Very interested';
  if (score >= 0.95) return 'Interested';
  if (score >= 0.85) return 'Considering it';
  return 'Not interested yet';
}

export function makeOffer(league: League, p: Player, orgId: number, years: number, aav: number, terms?: Terms): string | null {
  if (!p.fa) return 'Not a free agent';
  if (aav < league.settings.minSalary) return `Below the MLB minimum`;
  if (years < 1 || years > 10) return 'Contract length must be 1-10 years';
  if (p.fa.pending) return 'He has already agreed to terms';
  p.fa.offers = p.fa.offers.filter((o) => o.orgId !== orgId);
  p.fa.offers.push({ orgId, years, aav: roundSalary(aav), day: league.day, terms });
  if (orgId === league.userOrgId) offerMade(league, p);
  return null;
}

export function withdrawOffer(p: Player, orgId: number, league?: League): void {
  if (!p.fa) return;
  p.fa.offers = p.fa.offers.filter((o) => o.orgId !== orgId);
  // Backing out of an agreement still waiting on a roster move: he's back on the market.
  if (p.fa.pending?.orgId === orgId) {
    p.fa.pending = undefined;
    if (league) p.fa.decideDay = league.day + randInt(3, 8);
  }
}

// What's stopping an agreed signing from going through: a 40-man spot, and in
// season an active roster spot (he joins the big league club).
export function pendingBlock(league: League, orgId: number): string | null {
  if (fortyMan(league, orgId).length >= league.settings.fortyMax) return '40-man';
  if (league.phase === 'regular' && orgPlayers(league, orgId).filter((q) => q.level === 'MLB' && !q.il).length >= league.settings.activeMax) return 'active';
  return null;
}

// Agreed deals waiting on a roster move go through as soon as there's room
// (your assistant GM makes the move himself if he runs the roster).
export function finalizePending(league: League): string[] {
  const done: string[] = [];
  for (const p of Object.values(league.players)) {
    const pend = p.fa?.pending;
    if (!pend || p.orgId !== null) continue;
    const org = league.orgs[pend.orgId];
    let block = pendingBlock(league, org.id);
    if (block && delegated(league, org, 'roster')) {
      if (block === '40-man') {
        const cut = fortyMan(league, org.id).filter((q) => q.level !== 'MLB' && !q.il).sort((x, y) => ovr(x) + 0.5 * potOvr(x) - (ovr(y) + 0.5 * potOvr(y)))[0];
        if (cut) designate(league, cut);
      }
      block = pendingBlock(league, org.id);
      if (block === 'active') { makeMlbRoom(league, org, isPitcher(p), true); block = pendingBlock(league, org.id); }
    }
    if (block) continue;
    const o = pend.offer;
    p.fa!.pending = undefined;
    signFreeAgentOffer(league, p, o);
    done.push(pname(p));
  }
  return done;
}

export function signFreeAgentOffer(league: League, p: Player, o: FaOffer): void {
  const start = firstContractSeason(league);
  const fa = p.fa!;
  const yours = fa.offers.find((x) => x.orgId === league.userOrgId);
  p.orgId = o.orgId;
  touchRosters();
  p.on40 = true;
  // A big league free agent goes to the big leagues. With a full active roster
  // in season, the club makes room first (an AI club, or your assistant GM if he
  // runs the roster); otherwise you're over the limit until you make a move.
  const active = orgPlayers(league, o.orgId).filter((q) => q.level === 'MLB' && !q.il && q.id !== p.id).length;
  const sgOrg = league.orgs[o.orgId];
  let overLimit = false;
  if (league.phase === 'regular' && active >= league.settings.activeMax) {
    if (o.orgId !== league.userOrgId || delegated(league, sgOrg, 'roster')) makeMlbRoom(league, sgOrg, isPitcher(p), true);
    else overLimit = true;
  }
  p.level = 'MLB';
  p.contract = o.terms ? buildContract(o.terms, start, start) : { type: 'ML', salary: o.aav, minorSalary: 0, exp: start + o.years - 1, oneWay: true, signed: start };
  if (o.terms) bookDeferred(league.orgs[o.orgId], p, p.contract);
  p.fa = null;
  p.teamSince = start;
  p.faSigned = start;
  p.joined = { season: league.season, day: league.day };
  if (fa.qo && fa.formerOrg !== null && fa.formerOrg !== o.orgId) applyQoPenalty(league, o.orgId, fa.formerOrg, o.aav * o.years);
  if (fa.posted) {
    const fee = postingFee(o.aav * o.years);
    addTransaction(league, o.orgId, 'Posting fee', `Paid a ${fmtMoney(fee)} posting fee to ${pname(p)}'s ${fa.posted.from} club`, [p.id]);
    addNews(league, o.orgId, `${pname(p)}, posted by his ${fa.posted.from} club, signed with the ${league.orgs[o.orgId].affiliates.MLB.name}. Posting fee: ${fmtMoney(fee)}.`, [p.id]);
  }
  const org = league.orgs[o.orgId];
  const yrs = o.years === 1 ? '1 year' : `${o.years} years`;
  if (ovr(p) >= 55 || o.aav >= 8e6) addScoop(league, `Agreed: ${posLabel(p)} ${pname(p)} to the ${org.affiliates.MLB.name}, ${o.years} year${o.years === 1 ? '' : 's'}, ${fmtMoney(o.aav * o.years)} total (pending a physical).`, [p.id]);
  addTransaction(league, o.orgId, 'Sign', `Signed free agent ${posLabel(p)} ${pname(p)}: ${yrs}, $${(o.aav / 1e6).toFixed(2)}M per year`, [p.id]);
  const sides = [side(o.orgId, [p.id])];
  if (fa.formerOrg !== null && fa.formerOrg !== o.orgId) sides.push(side(fa.formerOrg, []));
  logMove(league, 'Free agent', sides, `${org.abbrev} signed ${posLabel(p)} ${pname(p)}: ${yrs}, ${fmtMoney(o.aav)}/yr`, o.aav * o.years);
  if (o.aav >= 10e6 || o.orgId === league.userOrgId || fa.formerOrg === league.userOrgId) {
    addNews(league, o.orgId, `${pname(p)} signed with the ${org.affiliates.MLB.name}: ${yrs}, $${((o.aav * o.years) / 1e6).toFixed(1)}M total.`, [p.id]);
  }
  // Tell the user: he signed with you, or someone you bid on went elsewhere.
  const deal = (x: FaOffer) => `${x.years === 1 ? '1 year' : `${x.years} years`} at ${fmtMoney(x.aav)} a year (${fmtMoney(x.aav * x.years)} total)`;
  if (o.orgId === league.userOrgId) {
    const forty = fortyMan(league, o.orgId).length;
    const slotted = slotNewcomer(league, sgOrg, p);
    addInbox(league, {
      from: 'Front office', subject: `${pname(p)} signed with you`, kind: 'info', pids: [p.id], stop: true, link: overLimit ? { page: 'roster-moves' } : undefined,
      text: `${posLabel(p)} ${pname(p)} accepted your offer: ${deal(o)}. He joins the major league roster${overLimit ? ', which puts you over the active limit: option or designate someone on the Roster Moves page before the next game' : ''}.${slotted ? ` ${slotted}` : ''} Your 40-man is at ${forty}/${league.settings.fortyMax}.${fa.qo && fa.formerOrg !== null && fa.formerOrg !== o.orgId ? ' He had declined a qualifying offer, so you lose a draft pick.' : ''}`,
    });
  } else if (yours) {
    addInbox(league, {
      from: 'Front office', subject: `${pname(p)} signed with the ${org.affiliates.MLB.name}`, kind: 'info', pids: [p.id], stop: true,
      text: `${posLabel(p)} ${pname(p)} chose the ${org.affiliates.MLB.name}: ${deal(o)}. Your offer was ${deal(yours)}.`,
    });
  }
}

// One day of the market.
// How AI clubs structure deals: opt-outs for stars, options for veterans,
// vesting options for relievers, no-trade clauses and deferrals on big deals.
export function aiTerms(league: League, org: Org, p: Player, years: number, aav: number): Terms {
  const age = firstContractSeason(league) - p.born;
  const o = ovr(p);
  const shape = years >= 4 && org.strategy === 'Contend' && rand() < 0.35 ? 'back' : years >= 3 && rand() < 0.15 ? 'front' : 'flat';
  let total = aav * years;
  const t: Terms = { sched: [] };
  if (o >= 58 && years >= 3 && rand() < 0.55) {
    t.optOuts = [Math.min(years - 2, rand() < 0.5 ? 1 : 2)];
    total *= 0.96; // he gives a little salary back for the opt-out
  }
  if (age >= 32 && years <= 2 && rand() < 0.45) {
    const r = rand();
    const sal = roundSalary(aav * (0.95 + rand() * 0.15));
    t.option = { type: r < 0.6 ? 'club' : 'mutual', season: 0, salary: sal, buyout: roundSalary(sal * 0.1) };
  } else if (p.pos === 'RP' && years >= 2 && rand() < 0.3) {
    t.option = { type: 'vesting', season: 0, salary: roundSalary(aav), buyout: roundSalary(aav * 0.1), vest: { stat: 'g', need: 60 } };
  } else if (p.pos === 'SP' && age >= 30 && years >= 2 && rand() < 0.2) {
    t.option = { type: 'vesting', season: 0, salary: roundSalary(aav), buyout: roundSalary(aav * 0.1), vest: { stat: 'ip', need: 160 } };
  } else if (years >= 2 && age <= 33 && o >= 55 && rand() < 0.12) {
    t.option = { type: 'player', season: 0, salary: roundSalary(aav), buyout: 0 };
  }
  if (aav * years >= 100e6 && rand() < 0.55) t.ntc = 'full';
  else if (aav * years >= 30e6 && rand() < 0.45) t.ntc = shuffle(league.orgs.filter((x) => x.id !== org.id)).slice(0, randInt(4, 10)).map((x) => x.id);
  if (aav * years >= 100e6 && rand() < (org.market >= 1.2 ? 0.4 : 0.2)) t.deferPct = Math.round((0.1 + rand() * 0.25) * 20) / 20;
  t.sched = shapeSchedule(total, years, shape);
  return t;
}

// He's taking your deal. With room on your roster he signs; without it the
// deal is agreed and waits on your corresponding move (like real life), unless
// your assistant GM runs the roster and makes room himself.
export function closeWithUser(league: League, p: Player, o: FaOffer): 'signed' | 'pending' {
  const fa = p.fa!;
  const block = pendingBlock(league, league.userOrgId);
  fa.pending = { orgId: league.userOrgId, day: league.day, offer: o };
  fa.offers = fa.offers.filter((x) => x.orgId === league.userOrgId);
  fa.talk = undefined;
  if (!block || delegated(league, league.orgs[league.userOrgId], 'roster')) {
    finalizePending(league);
    if (!p.fa?.pending) return 'signed';
  }
  const now = pendingBlock(league, league.userOrgId);
  const what = now === '40-man'
    ? `your 40-man roster is full (${fortyMan(league, league.userOrgId).length}/${league.settings.fortyMax}): designate, release or trade someone on it`
    : `your active roster is full: option, designate or place someone on the IL`;
  addInbox(league, {
    from: 'Front office', subject: `${pname(p)} agreed to terms: a roster move is needed`, kind: 'info', pids: [p.id], stop: true, link: { page: 'roster-moves' },
    text: `${posLabel(p)} ${pname(p)} accepted your offer (${o.years === 1 ? '1 year' : `${o.years} years`} at ${fmtMoney(o.aav)} a year), pending a corresponding move: ${what}. The signing becomes official as soon as there's room. He's off the market in the meantime; you can back out on the Free Agents page.`,
  });
  if (notableFa(p)) addScoop(league, `Agreed: ${posLabel(p)} ${pname(p)} to the ${league.orgs[league.userOrgId].affiliates.MLB.name}, pending a roster move.`, [p.id]);
  return 'pending';
}

// Big enough that the insiders cover him.
const notableFa = (p: Player) => ovr(p) >= 55 || p.fa!.asking.aav >= 8e6;

export function faDay(league: League): void {
  milbBidDay(league);
  finalizePending(league);
  agentReplies(league);
  const offseasonPhase = league.phase === 'offseason' || league.phase === 'preseason';
  // In season the market is thin: clubs make offers every few days, but players still decide on their dates.
  const quiet = !offseasonPhase && league.day % 3 !== 0;
  // A free agent with no market status (an old generation bug) gets one.
  for (const p of Object.values(league.players)) if (!p.fa && isFreeAgent(p) && ovr(p) >= 45) openFreeAgent(league, p, null);
  const fas = Object.values(league.players).filter((p) => p.fa && isFreeAgent(p) && !isMinorFA(league, p));
  if (!fas.length) return;
  const depth = buildDepth(league);
  // 40-man counts as the rules (and the Free Agents page) count them: the 60-day IL doesn't.
  const fortyCount = new Map<number, number>();
  for (const org of league.orgs) fortyCount.set(org.id, fortyMan(league, org.id).length);
  const nextSeason = firstContractSeason(league);
  const offseason = offseasonPhase;

  // Clubs don't wait forever. A club whose offer has sat a while may pull it to
  // go after someone else (each club has its own patience), and a club that has
  // spent its budget on other signings pulls offers it can no longer afford.
  // (Your own offers stay until you withdraw them.)
  for (const p of fas) {
    const fa = p.fa!;
    fa.offers = fa.offers.filter((o) => {
      if (o.orgId === league.userOrgId) return true;
      const org = league.orgs[o.orgId];
      const room = payrollTarget(org) * 1.05 - committed(league, org.id, nextSeason);
      if (o.aav > room) {
        if (notableFa(p) && rand() < 0.5) addScoop(league, `Sources: the ${org.affiliates.MLB.name} no longer have the room for ${posLabel(p)} ${pname(p)} after their other moves.`, [p.id]);
        return false;
      }
      const patience = 10 + ((org.id * 7919 + p.id * 104729) % 21); // 10-30 days
      if (league.day - o.day > patience && rand() < 0.12) {
        fa.passed = [...(fa.passed ?? []), o.orgId];
        if (notableFa(p) && rand() < 0.5) addScoop(league, `Sources: tired of waiting, the ${org.affiliates.MLB.name} have moved on from ${posLabel(p)} ${pname(p)}.`, [p.id]);
        return false;
      }
      return true;
    });
  }

  // AI offers
  const ranked = [...fas].sort((a, b) => ovr(b) - ovr(a)).slice(0, 80);
  // Offers still on the table count against a club's budget until they're answered.
  const pending = new Map<number, number>();
  for (const p of fas) for (const o of p.fa!.offers) pending.set(o.orgId, (pending.get(o.orgId) ?? 0) + o.aav);
  for (const org of league.orgs) {
    if (quiet || org.id === league.userOrgId) continue;
    if (rand() > (offseason ? 0.35 : 0.2)) continue;
    const fullForty = (fortyCount.get(org.id) ?? 0) >= league.settings.fortyMax;
    const overNow = orgPayroll(league, org).cbt > org.budget;
    // Last year's juggernauts don't get first dibs on every star.
    const juggernaut = (league.lastWins?.[org.id] ?? 0) >= 98;
    let budget = payrollTarget(org) * (0.92 + rand() * 0.16) - committed(league, org.id, nextSeason) - (pending.get(org.id) ?? 0);
    let made = 0;
    for (const p of ranked) {
      if (made >= 3 || budget <= 0) break;
      if (p.fa!.pending || p.fa!.offers.some((o) => o.orgId === org.id) || p.fa!.passed?.includes(org.id)) continue;
      const ageNext = nextSeason - p.born;
      if (org.strategy === 'Rebuild' && (ageNext >= 30 || p.fa!.asking.years > 2) && p.fa!.asking.aav > 5e6) continue;
      const cheap = p.fa!.asking.aav <= 4e6;
      if (overNow && !cheap) continue;
      const need = ovr(p) - incumbent(depth, org.id, p, cheap);
      if (need < (cheap ? 0.5 : juggernaut ? 3.5 : 1.5)) continue;
      // A full 40-man only stops a club for marginal players; for a real upgrade it makes room.
      if (fullForty && (cheap || need < 4)) continue;
      const mv = marketValue(p, league.settings);
      const eager = org.strategy === 'Contend' ? 1.08 : org.strategy === 'Rebuild' ? 0.95 : 1;
      const aav = roundSalary(Math.min(mv * 1.15 * eager, p.fa!.asking.aav * (0.86 + rand() * 0.22) * eager));
      if (aav > budget) continue;
      const years = clamp(p.fa!.asking.years + (rand() < 0.3 ? -1 : 0) + (rand() < 0.15 ? 1 : 0), 1, 8);
      const terms = aiTerms(league, org, p, years, aav);
      p.fa!.offers.push({ orgId: org.id, years, aav, day: league.day, terms });
      rivalAlert(league, p, p.fa!.offers[p.fa!.offers.length - 1]);
      if (notableFa(p) && rand() < 0.4) {
        const how = rand() < 0.5 ? 'met with' : rand() < 0.5 ? 'made an offer to' : 'have checked in on';
        addScoop(league, `Sources: the ${org.affiliates.MLB.name} ${how} free agent ${posLabel(p)} ${pname(p)}.`, [p.id]);
      }
      budget -= aav;
      made++;
    }
  }

  // Decisions
  for (const p of fas) {
    const fa = p.fa!;
    if (fa.pending) continue;
    const scored = fa.offers.map((o) => ({ o, s: offerScore(league, p, o) })).sort((a, b) => b.s - a.s);
    const best = scored[0];
    const due = league.day >= fa.decideDay;
    // A blowaway offer can end it early, but a big name sticks to at least part
    // of his own timeline (some decide in days, others take months).
    const notable = fa.asking.aav > 8e6;
    const wait = notable ? Math.round((fa.decideDay - fa.opened) * 0.4) : 0;
    const early = best && best.s >= 1.12 && league.day - fa.opened >= wait && rand() < (notable ? 0.1 : 0.25);
    // The insider names the finalists a few days before a big free agent decides.
    if (notableFa(p) && (fa.scooped ?? 0) < 2 && fa.decideDay - league.day <= 3 && scored.length >= 2) {
      fa.scooped = 2;
      const names = scored.slice(0, 3).map((x) => league.orgs[x.o.orgId].affiliates.MLB.name);
      addScoop(league, `${pname(p)} is nearing a decision. Finalists: the ${names.join(', the ')}.`, [p.id]);
    }
    // A fluid market: a strong offer pulls his date in; a near-tie at the top
    // buys a few more days for the clubs to outbid each other.
    if (best && best.s >= 1.0 && fa.decideDay - league.day > 8) fa.decideDay = league.day + randInt(3, 8);
    if (due && !fa.extended && scored.length >= 2 && best.s >= 0.95 && scored[1].s >= best.s - 0.04) {
      fa.extended = true;
      fa.decideDay = league.day + randInt(2, 4);
      const mine = scored.findIndex((x) => x.o.orgId === league.userOrgId);
      if (mine === 0 || mine === 1) {
        const other = league.orgs[scored[mine === 0 ? 1 : 0].o.orgId].affiliates.MLB.name;
        addInbox(league, {
          from: `Agent for ${pname(p)}`, subject: `${pname(p)}: it's close`, kind: 'info', pids: [p.id], stop: true, link: { page: 'negotiate', args: ['fa', p.id] },
          text: `It's between you and the ${other}, and it's close. ${p.first} is taking a few more days (until ${dayShort(league.season, fa.decideDay)}). ${mine === 0 ? 'You have the edge right now; a little more would lock it up.' : 'They have the edge right now; a better offer could swing it.'}`,
        });
      }
      continue;
    }
    if (!due && !early) continue;
    // He picked you (see closeWithUser: signs now, or agrees and waits on your roster move).
    if (best && best.s >= 0.85 && best.o.orgId === league.userOrgId) {
      closeWithUser(league, p, best.o);
      fortyCount.set(league.userOrgId, fortyMan(league, league.userOrgId).length);
      continue;
    }
    if (best && best.s >= 0.85) {
      // AI club with a full 40-man: designate its least valuable player off the 40-man first.
      if (best.o.orgId !== league.userOrgId && fortyMan(league, best.o.orgId).length >= league.settings.fortyMax) {
        const cut = fortyMan(league, best.o.orgId).filter((q) => q.level !== 'MLB' && !q.il).sort((x, y) => ovr(x) + 0.5 * potOvr(x) - (ovr(y) + 0.5 * potOvr(y)))[0];
        if (!cut) continue;
        designate(league, cut);
      }
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
