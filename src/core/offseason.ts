// The offseason calendar, from the end of the World Series to Opening Day.
//
//  WS +2      club/player options, qualifying offers
//  WS +5      free agency opens; minor league free agents
//  WS +12     players answer qualifying offers
//  Nov 18     Rule 5 protection deadline
//  Nov 22     non-tender deadline
//  Dec 10     Rule 5 draft
//  Dec 15     international class revealed
//  Jan 9      arbitration figures exchanged
//  Jan 15     international signing period opens
//  Feb 5      arbitration hearings
//  Feb 15     new season: aging, development, retirements, new schedule
//  Opening Day
import type { League, Org, Player } from './types.ts';
import { LEVELS } from './types.ts';
import { dayToDate } from './settings.ts';
import { cbtTax, fmtMoney, marketValue, orgPayroll, roundSalary, serviceYears } from './contracts.ts';
import { displayOvr, isPitcher, ovr, perceivedOvr, potOvr } from './ratings.ts';
import { addNews, addTransaction, fortyMan, orgPlayers, pname, sumBat, sumPit, touchRosters } from './util.ts';
import { agmEvalSd, delegated, staffContractsExpire, staffOf } from './staff.ts';
import { firstContractSeason, isFreeAgent, openFreeAgent } from './freeAgency.ts';
import { posLabel } from './rules.ts';
import { clamp, normal, rand } from './random.ts';
import { developPlayer, recenterRatings, yearlyPotentialDrift } from './development.ts';
import { buildSchedule } from './schedule.ts';
import { emptyStanding } from './league.ts';
import { generateCbPicks, generateDraftClass } from './draft.ts';
import { ownerSales, reviewGm, setBudgets, setOwnerGoals, updateStrategies } from './owners.ts';
import { generateIfaClass, isIfa, negotiationDay, openIfaPeriod, postPlayers, setupIfaPools } from './intl.ts';
import { logMove, side } from './moves.ts';
import { marketOvr, seasonCtx } from './war.ts';
import { setDeptBudgets, updateFacilities } from './depts.ts';
import { salaryIn, syncContract } from './terms.ts';
import { addInbox } from './morale.ts';
import { dayShort } from './settings.ts';
import { archiveSeason, hallOfFameVote, seasonAwards } from './awards.ts';
import { closeBooks } from './finances.ts';

export interface CalEvent {
  key: string;
  label: string;
  day: number; // league day it happens on
  decision?: { duty: Parameters<typeof delegated>[2]; page: string; text: string };
}

function dayOfDate(league: League, month: number, date: number): number {
  const year = month >= 8 ? league.season : league.season + 1;
  const open = dayToDate(league.season, 0).getTime();
  return Math.round((Date.UTC(year, month, date) - open) / 86400000);
}

export function offseasonCalendar(league: League): CalEvent[] {
  const ws = league.wsEndDay ?? league.day;
  return [
    { key: 'options', label: 'Contract options and qualifying offers', day: ws + 2, decision: { duty: 'options', page: 'offseason', text: 'Decide club options and qualifying offers on the Offseason page.' } },
    { key: 'fa-open', label: 'Free agency opens', day: ws + 5 },
    { key: 'qo-response', label: 'Players respond to qualifying offers', day: ws + 12 },
    { key: 'r5-protect', label: 'Rule 5 protection deadline', day: dayOfDate(league, 10, 18), decision: { duty: 'rule5protect', page: 'rule5', text: 'Add any prospects you want to protect to the 40-man roster on the Rule 5 page.' } },
    { key: 'tender', label: 'Non-tender deadline', day: dayOfDate(league, 10, 22), decision: { duty: 'tender', page: 'tenders', text: 'Choose who to tender on the Tenders & Arbitration page.' } },
    { key: 'posting', label: 'International pros posted', day: dayOfDate(league, 10, 25) },
    { key: 'winter-meetings', label: 'Winter Meetings (trade market heats up)', day: dayOfDate(league, 11, 7) },
    { key: 'fa-late', label: 'Late free agent market', day: dayOfDate(league, 0, 2) },
    { key: 'r5-draft', label: 'Rule 5 draft', day: dayOfDate(league, 11, 10), decision: { duty: 'rule5draft', page: 'rule5', text: 'Pick your Rule 5 targets on the Rule 5 page.' } },
    { key: 'ifa-class', label: 'International class revealed (negotiations open)', day: dayOfDate(league, 11, 15) },
    { key: 'ifa-shake', label: 'International negotiation day', day: dayOfDate(league, 0, 1) },
    { key: 'arb-exchange', label: 'Arbitration figures exchanged', day: dayOfDate(league, 0, 9), decision: { duty: 'arbitration', page: 'tenders', text: 'Set your arbitration figures or settle on the Tenders & Arbitration page.' } },
    { key: 'ifa-open', label: 'International signing day', day: dayOfDate(league, 0, 15) },
    { key: 'arb-hearings', label: 'Arbitration hearings', day: dayOfDate(league, 1, 5), decision: { duty: 'arbitration', page: 'tenders', text: 'Last chance to settle arbitration cases before hearings.' } },
    { key: 'rollover', label: 'Spring training: new season begins', day: dayOfDate(league, 1, 15) },
  ];
}

// ---------- end of season ----------

export function onSeasonEnd(league: League): void {
  league.wsEndDay = league.day;
  league.events = [];
  league.phase = 'offseason';
  const st = league.standings.MLB;
  league.lastStandings = league.orgs.map((o) => o.id).sort((a, b) => st[a].w - st[a].l - (st[b].w - st[b].l));
  league.lastWins = Object.fromEntries(league.orgs.map((o) => [o.id, st[o.id].w]));
  seasonAwards(league);
  archiveSeason(league);
  closeBooks(league);
  // Hold the run environment near 4.45 runs per game as talent shifts.
  {
    const rg = seasonCtx(league, league.season).ra9;
    if (rg > 2 && rg < 8) league.offenseAdj = clamp((league.offenseAdj ?? 0) + clamp((4.45 - rg) * 4, -3, 3), -10, 10);
  }
  league.lastPlayoffTeams = league.playoffs ? [...league.playoffs.seeds.AL, ...league.playoffs.seeds.NL] : [];
  for (const org of league.orgs) {
    const pay = orgPayroll(league, org);
    const t = cbtTax(pay.cbt, org.cbtPayerYears, league.settings);
    league.cbtHistory.push({ season: league.season, orgId: org.id, cbt: pay.cbt, tax: t.tax });
    org.tenderPlan = {};
    org.optionPlan = {};
    org.qoPlan = {};
    org.rule5Targets = [];
  }
  reviewGm(league);
  updateFacilities(league);
  const user = league.orgs[league.userOrgId];
  const expiring = league.staff.filter((s) => s.orgId === user.id && s.exp <= league.season);
  if (expiring.length) {
    addNews(league, user.id, `Staff contracts ending this winter: ${expiring.map((s) => `${s.first} ${s.last} (${s.role})`).join(', ')}. Extend them on the Staff page or they leave at spring training.`);
  }
  // Injured list stints end with the season (players keep healing).
  for (const p of Object.values(league.players)) {
    p.arb = null;
    if (p.il) {
      p.level = p.il.returnLevel;
      p.il = null;
    }
  }
}

// ---------- options & qualifying offers ----------

export function qoAmount(league: League): number {
  const sal = Object.values(league.players)
    .filter((p) => p.orgId !== null && p.contract.type === 'ML')
    .map((p) => p.contract.salary)
    .sort((a, b) => b - a)
    .slice(0, 125);
  return roundSalary(sal.reduce((t, x) => t + x, 0) / Math.max(1, sal.length));
}

export function pendingOptions(league: League, orgId: number): Player[] {
  return orgPlayers(league, orgId).filter((p) => p.contract.type === 'ML' && p.contract.exp === league.season && p.contract.option?.season === league.season + 1);
}

export function qoEligible(league: League, orgId: number): Player[] {
  const s = league.settings;
  return orgPlayers(league, orgId).filter(
    (p) => p.contract.type === 'ML' && p.contract.exp === league.season && !p.contract.option && serviceYears(p.mlServiceDays, s) >= 6 && !p.qoReceived && p.on40,
  );
}

function aiExercise(league: League, org: Org, p: Player): boolean {
  // The assistant GM's read of the player shades the market value he expects.
  const shade = 1 + (perceivedOvr(league, p, agmEvalSd(league, org)) - ovr(p)) * 0.03;
  return p.contract.option!.salary <= marketValue(p, league.settings) * shade;
}

// Clubs extend a qualifying offer only when they'd be happy either way: he
// clearly out-earns it on the market (so he declines and they get a pick), or a
// one-year deal at the QO is fine value. The club judges him as it sees him,
// production included; older players and relievers need a bigger cushion.
function qoMarket(league: League, org: Org, p: Player): number {
  const read = perceivedOvr(league, p, agmEvalSd(league, org));
  return marketValue(p, league.settings, marketOvr(league, p, read, 0.5));
}
function aiOfferQo(league: League, org: Org, p: Player, qo: number): boolean {
  const age = league.season + 1 - p.born;
  const need = age >= 34 ? 1.35 : p.pos === 'RP' ? 1.3 : age >= 32 ? 1.12 : 1.05;
  return qoMarket(league, org, p) >= qo * need;
}

// Did a vesting option vest? Checked against his final guaranteed season.
export function vested(league: League, p: Player): boolean {
  const v = p.contract.option?.vest;
  if (!v) return false;
  const es = p.stats.filter((s) => s.season === league.season && s.level === 'MLB');
  const n = es.reduce((t, s) => t + (v.stat === 'pa' ? s.bat.pa : v.stat === 'ip' ? s.pit.outs / 3 : s.pit.g), 0);
  return n >= v.need;
}

// Players with an opt-out after this season leave if the market pays more.
function runOptOuts(league: League): void {
  for (const p of Object.values(league.players)) {
    const c = p.contract;
    if (p.orgId === null || c.type !== 'ML' || !c.optOuts?.includes(league.season) || c.exp <= league.season) continue;
    let owed = 0;
    for (let y = league.season + 1; y <= c.exp; y++) owed += salaryIn(c, y);
    const left = c.exp - league.season;
    const mv = marketValue(p, league.settings, marketOvr(league, p, ovr(p), 0.5));
    const age = league.season + 1 - p.born;
    const yrs = Math.max(1, Math.min(left + 2, age <= 30 ? 7 : age <= 33 ? 4 : 2));
    const org = league.orgs[p.orgId];
    if (mv * yrs > owed * 1.08 && mv > (owed / left) * 1.05) {
      p.contract = { ...c, exp: league.season, sched: c.sched?.slice(0, league.season - (c.start ?? league.season) + 1), option: undefined, optOuts: undefined };
      addTransaction(league, org.id, 'Opt-out', `${posLabel(p)} ${pname(p)} opted out of the last ${left} year${left === 1 ? '' : 's'} (${fmtMoney(owed)}) of his contract`, [p.id]);
      addNews(league, null, `${pname(p)} opted out of his deal with the ${org.affiliates.MLB.name}, walking away from ${fmtMoney(owed)} to test free agency.`, [p.id]);
    } else {
      p.contract = { ...c, optOuts: c.optOuts.filter((s) => s !== league.season) };
      if (mv > 15e6 || p.orgId === league.userOrgId) addNews(league, p.orgId === league.userOrgId ? p.orgId : null, `${pname(p)} will not opt out; he stays with the ${org.affiliates.MLB.name} (${fmtMoney(owed)} left).`, [p.id]);
    }
  }
}

function runOptions(league: League): void {
  const qo = qoAmount(league);
  runOptOuts(league);
  for (const org of league.orgs) {
    const auto = delegated(league, org, 'options');
    for (const p of pendingOptions(league, org.id)) {
      const opt = p.contract.option!;
      const club = () => (auto ? aiExercise(league, org, p) : (org.optionPlan[p.id] ?? aiExercise(league, org, p)));
      // The player picks up his side when it beats what he'd get on the market.
      const playerYes = () => opt.salary >= marketValue(p, league.settings, marketOvr(league, p, ovr(p), 0.5)) * 0.95;
      let exercise: boolean;
      let how: string;
      if (opt.type === 'vesting' && vested(league, p)) { exercise = true; how = 'Vesting option vested for'; }
      else if (opt.type === 'club' || opt.type === 'vesting') { exercise = club(); how = exercise ? 'Exercised the club option on' : 'Declined the club option on'; }
      else if (opt.type === 'mutual') { exercise = club() && playerYes(); how = exercise ? 'Both sides exercised the mutual option on' : 'Mutual option declined (buyout paid):'; }
      else { exercise = playerYes(); how = exercise ? 'Player option exercised by' : 'Player declined his option:'; }
      if (exercise) {
        const c = p.contract;
        p.contract = { ...c, salary: opt.salary, exp: opt.season, option: undefined, sched: c.sched ? [...c.sched, opt.salary] : undefined };
        addTransaction(league, org.id, 'Option', `${how} ${posLabel(p)} ${pname(p)} (${fmtMoney(opt.salary)})`, [p.id]);
      } else {
        if (opt.type !== 'player' && opt.buyout > 0) org.deadMoney.push({ pid: p.id, name: pname(p), amount: opt.buyout, season: league.season });
        p.contract = { ...p.contract, option: undefined };
        addTransaction(league, org.id, 'Option', `${how} ${posLabel(p)} ${pname(p)}`, [p.id]);
      }
    }
    for (const p of qoEligible(league, org.id)) {
      const offer = auto ? aiOfferQo(league, org, p, qo) : (org.qoPlan[p.id] ?? false);
      if (!offer) continue;
      p.qoReceived = true;
      p.arb = null;
      p.qoPending = qo;
      addTransaction(league, org.id, 'QO', `Extended a $${(qo / 1e6).toFixed(2)}M qualifying offer to ${posLabel(p)} ${pname(p)}`, [p.id]);
    }
  }
}

// ---------- free agency opens ----------

function runFaOpen(league: League): void {
  const s = league.settings;
  updateStrategies(league);
  // Owners budget knowing next year's guaranteed money and arbitration raises.
  const super2 = superTwoSet(league);
  setBudgets(league, (org) => orgPlayers(league, org.id).reduce((t, p) => {
    const c = p.contract;
    if (c.type !== 'ML') return t;
    if (c.exp > league.season) return t + c.salary;
    if (!p.on40 || serviceYears(p.mlServiceDays, s) >= 6) return t;
    const st = arbStatus(league, p, super2);
    if (!st.eligible) return t + s.minSalary;
    return ovr(p) >= 44 ? t + arbProjection(league, p, st.year) : t;
  }, 0));
  let nMl = 0;
  let nMilb = 0;
  for (const p of Object.values(league.players)) {
    if (p.orgId === null || p.retired) continue;
    const c = p.contract;
    if (c.exp !== league.season) continue;
    const former = p.orgId;
    if (c.type === 'ML') {
      const qoP = p.qoPending;
      if (qoP) continue; // decides later
      if (serviceYears(p.mlServiceDays, s) >= 6 || !p.on40) {
        openFreeAgent(league, p, former);
        nMl++;
      }
      // Under club control: waits for the tender deadline.
    } else {
      // Minor league contracts: 6+ seasons and off the 40-man -> minor league free agent.
      if (p.proSeasons >= 6 && !p.on40) {
        openFreeAgent(league, p, former);
        nMilb++;
      } else {
        c.exp = league.season + 1;
      }
    }
  }
  addNews(league, null, `Free agency is open: ${nMl} major league and ${nMilb} minor league free agents.`);
  // AI clubs clear 40-man space for the winter by outrighting their weakest depth.
  for (const org of league.orgs) {
    if (!delegated(league, org, 'roster')) continue;
    const forty = fortyMan(league, org.id).filter((p) => !p.arb);
    const value = (p: Player) => (league.season - p.born >= 26 ? ovr(p) : 0.5 * ovr(p) + 0.5 * potOvr(p));
    forty.sort((a, b) => value(a) - value(b));
    let n = forty.length;
    for (const p of forty) {
      if (n <= league.settings.fortyMax - 4) break;
      if (p.contract.oneWay && p.contract.salary > 3e6) continue;
      p.on40 = false;
      p.waivers = { day: league.day, fromOrg: org.id, type: 'outright' };
      addTransaction(league, org.id, 'Waivers', `Placed ${posLabel(p)} ${pname(p)} on outright waivers`, [p.id]);
      n--;
    }
  }
}

function runQoResponses(league: League): void {
  for (const p of Object.values(league.players)) {
    if (!p.qoPending || p.orgId === null) continue;
    const qo = p.qoPending;
    delete p.qoPending;
    // He weighs one guaranteed year at the QO against what free agency would
    // likely bring: his market value over the years a player his age gets,
    // shaded down because signing him costs a club a draft pick.
    const age = league.season + 1 - p.born;
    const mv = marketValue(p, league.settings, marketOvr(league, p, ovr(p), 0.5)) * 0.9;
    const years = age <= 30 ? 4 : age <= 32 ? 3 : age <= 34 ? 2 : 1;
    const accept = mv < qo * 0.95 && (mv * years < qo * 1.6 || rand() < 0.35);
    const org = p.orgId;
    if (accept) {
      p.contract = { type: 'ML', salary: qo, minorSalary: 0, exp: league.season + 1, oneWay: true, signed: league.season + 1 };
      addTransaction(league, org, 'QO', `${posLabel(p)} ${pname(p)} accepted the qualifying offer`, [p.id]);
      if (org === league.userOrgId) addNews(league, org, `${pname(p)} accepted your qualifying offer.`, [p.id]);
    } else {
      openFreeAgent(league, p, org, true);
      addTransaction(league, org, 'QO', `${posLabel(p)} ${pname(p)} declined the qualifying offer and became a free agent`, [p.id]);
    }
  }
}

// ---------- Rule 5 ----------

export function rule5Eligible(_league: League, p: Player): boolean {
  if (p.orgId === null || p.on40 || p.retired || p.prospect || p.ifa) return false;
  if (p.contract.type !== 'MiLB' && p.contract.type !== 'ML') return false;
  const signAge = p.signAge ?? 19;
  return p.proSeasons >= (signAge <= 18 ? 4 : 3);
}

function protectValue(p: Player): number {
  return 0.45 * ovr(p) + 0.55 * potOvr(p);
}

function runProtection(league: League): void {
  for (const org of league.orgs) {
    if (!delegated(league, org, 'rule5protect')) continue;
    const sd = agmEvalSd(league, org);
    const elig = orgPlayers(league, org.id)
      .filter((p) => rule5Eligible(league, p))
      .map((p) => ({ p, v: protectValue(p) + sd * normal(0, 0.5) }))
      .sort((a, b) => b.v - a.v);
    for (const { p, v } of elig) {
      if (fortyMan(league, org.id).length >= league.settings.fortyMax - 1) break;
      if (v < 46) break;
      p.on40 = true;
      p.contract = { type: 'ML', salary: league.settings.minSalary, minorSalary: league.settings.minorSalaryFirstML, exp: league.season + 1, oneWay: false, signed: league.season + 1 };
      addTransaction(league, org.id, '40-man', `Added ${posLabel(p)} ${pname(p)} to the 40-man roster (Rule 5 protection)`, [p.id]);
    }
  }
}

function runRule5Draft(league: League): void {
  const order = league.lastStandings ?? league.orgs.map((o) => o.id);
  let taken = 0;
  for (let round = 1; round <= 2; round++) {
    for (const orgId of order) {
      const org = league.orgs[orgId];
      if (fortyMan(league, orgId).length >= league.settings.fortyMax) continue;
      const pool = Object.values(league.players).filter((p) => rule5Eligible(league, p) && p.orgId !== orgId);
      let pick: Player | undefined;
      if (orgId === league.userOrgId && !delegated(league, org, 'rule5draft')) {
        pick = org.rule5Targets.map((id) => league.players[id]).find((p) => p && pool.includes(p));
      } else {
        const sd = agmEvalSd(league, org);
        const best = pool.map((p) => ({ p, v: perceivedOvr(league, p, sd) })).sort((a, b) => b.v - a.v)[0];
        const mlb = orgPlayers(league, orgId).filter((q) => q.level === 'MLB' && q.on40 && best && isPitcher(q) === isPitcher(best.p));
        const worst = Math.min(...mlb.map(ovr), 99);
        if (best && best.v >= 46 && best.v > worst + 1 && rand() < 0.6) pick = best.p;
      }
      if (!pick) continue;
      const from = pick.orgId!;
      pick.orgId = orgId;
      touchRosters();
      pick.teamSince = league.season + 1;
      pick.joined = { season: league.season, day: league.day };
      pick.on40 = true;
      pick.level = 'MLB';
      pick.rule5 = { fromOrg: from, season: league.season + 1 };
      pick.contract = { type: 'ML', salary: league.settings.minSalary, minorSalary: league.settings.minorSalaryFirstML, exp: league.season + 1, oneWay: false, signed: league.season + 1 };
      taken++;
      addTransaction(league, orgId, 'Rule 5', `Selected ${posLabel(pick)} ${pname(pick)} from the ${league.orgs[from].affiliates.MLB.name} in the Rule 5 draft`, [pick.id]);
      logMove(league, 'Rule 5', [side(orgId, [pick.id]), side(from, [])], `${org.abbrev} took ${posLabel(pick)} ${pname(pick)} from ${league.orgs[from].abbrev}`, league.settings.minSalary);
      if (orgId === league.userOrgId || from === league.userOrgId) {
        addNews(league, orgId, `Rule 5 draft: the ${org.affiliates.MLB.name} took ${pname(pick)} from the ${league.orgs[from].affiliates.MLB.name}. He must stay on their MLB roster all season or be offered back.`, [pick.id]);
      }
    }
  }
  addNews(league, null, `Rule 5 draft: ${taken} players selected.`);
}

// ---------- tenders & arbitration ----------

export function controlledExpiring(league: League, orgId: number): Player[] {
  const s = league.settings;
  return orgPlayers(league, orgId).filter((p) => p.on40 && p.contract.type === 'ML' && p.contract.exp === league.season && serviceYears(p.mlServiceDays, s) < 6);
}

export function superTwoSet(league: League): Set<number> {
  const s = league.settings;
  const cands = Object.values(league.players).filter((p) => {
    const y = serviceYears(p.mlServiceDays, s);
    return p.orgId !== null && y === 2 && p.serviceThisSeason >= 86;
  });
  cands.sort((a, b) => b.mlServiceDays - a.mlServiceDays);
  return new Set(cands.slice(0, Math.ceil(cands.length * 0.22)).map((p) => p.id));
}

export function arbStatus(league: League, p: Player, super2: Set<number>): { eligible: boolean; year: number } {
  const y = serviceYears(p.mlServiceDays, league.settings);
  if (y >= 3) return { eligible: true, year: y - 3 + (super2.has(p.id) ? 1 : 0) + 1 };
  if (super2.has(p.id)) return { eligible: true, year: 1 };
  return { eligible: false, year: 0 };
}

export function arbProjection(league: League, p: Player, year: number): number {
  const frac = [0.2, 0.36, 0.52, 0.68][clamp(year - 1, 0, 3)];
  // Arbitration is argued with stats: the platform year and career numbers.
  const v = marketValue(p, league.settings, marketOvr(league, p, ovr(p), 0.6)) * frac;
  const prev = p.contract.salary;
  // Arbitration salaries can't be cut more than 20% and usually rise.
  return roundSalary(Math.max(league.settings.minSalary, prev * 0.8, Math.max(v, prev * (year > 1 ? 1.05 : 1))));
}

function aiTender(league: League, org: Org, p: Player, projected: number, arb: boolean): boolean {
  const v = perceivedOvr(league, p, agmEvalSd(league, org));
  if (!arb) return v >= 38 || potOvr(p) >= 48;
  const mv = marketValue(p, league.settings);
  // Clubs over budget get pickier about raises.
  const tight = orgPayroll(league, org).cbt + projected > org.budget;
  return v >= (tight ? 46 : 43) && projected <= mv * (tight ? 0.95 : 1.1);
}

function runTenders(league: League): void {
  const super2 = superTwoSet(league);
  for (const org of league.orgs) {
    const auto = delegated(league, org, 'tender');
    for (const p of controlledExpiring(league, org.id)) {
      const st = arbStatus(league, p, super2);
      const projected = st.eligible ? arbProjection(league, p, st.year) : league.settings.minSalary;
      const tender = auto ? aiTender(league, org, p, projected, st.eligible) : (org.tenderPlan[p.id] ?? true);
      if (!tender) {
        addTransaction(league, org.id, 'Non-tender', `Non-tendered ${posLabel(p)} ${pname(p)}`, [p.id]);
        openFreeAgent(league, p, org.id);
        continue;
      }
      if (st.eligible) {
        p.arb = { projected, player: null, team: null, settled: null, result: null };
        p.contract = { type: 'ML', salary: projected, minorSalary: 0, exp: league.season + 1, oneWay: true, signed: league.season + 1 };
      } else {
        const y = serviceYears(p.mlServiceDays, league.settings);
        p.contract = {
          type: 'ML',
          salary: roundSalary(league.settings.minSalary * (1 + y * 0.03)),
          minorSalary: p.mlServiceDays > 0 ? league.settings.minorSalarySecondML : league.settings.minorSalaryFirstML,
          exp: league.season + 1,
          oneWay: false,
          signed: league.season + 1,
        };
      }
    }
  }
  addNews(league, null, 'The non-tender deadline has passed.');
}

export function settleArb(league: League, p: Player, amount: number, how: string): void {
  if (!p.arb) return;
  p.arb.settled = roundSalary(amount);
  p.arb.result = how;
  p.contract.salary = p.arb.settled;
  addTransaction(league, p.orgId, 'Arbitration', `${how}: ${posLabel(p)} ${pname(p)}, $${(p.arb.settled / 1e6).toFixed(2)}M`, [p.id]);
}

function runArbExchange(league: League): void {
  for (const p of Object.values(league.players)) {
    const a = p.arb;
    if (!a || a.settled !== null || p.orgId === null) continue;
    const org = league.orgs[p.orgId];
    const auto = delegated(league, org, 'arbitration');
    // Most cases settle before figures are exchanged.
    if ((p.orgId !== league.userOrgId || auto) && rand() < 0.8) {
      settleArb(league, p, a.projected * (0.97 + rand() * 0.06), 'Avoided arbitration');
      continue;
    }
    a.player = roundSalary(a.projected * (1.05 + rand() * 0.1));
    if (a.team === null) a.team = roundSalary(a.projected * (0.9 + rand() * 0.04));
    a.team = Math.min(a.team, a.player);
  }
}

function runArbHearings(league: League): void {
  for (const p of Object.values(league.players)) {
    const a = p.arb;
    if (!a || a.settled !== null || p.orgId === null) continue;
    const org = league.orgs[p.orgId];
    if (delegated(league, org, 'arbitration') && rand() < 0.6 && a.player && a.team) {
      settleArb(league, p, (a.player + a.team) / 2, 'Settled at the midpoint');
      continue;
    }
    const truth = a.projected * (1 + normal(0, 0.07));
    const pf = a.player ?? a.projected * 1.1;
    const tf = a.team ?? a.projected * 0.92;
    const playerWins = Math.abs(pf - truth) < Math.abs(tf - truth);
    settleArb(league, p, playerWins ? pf : tf, playerWins ? 'Won his arbitration hearing' : 'Lost his arbitration hearing (team figure)');
    if (p.orgId === league.userOrgId) addNews(league, p.orgId, `${pname(p)} ${playerWins ? 'won' : 'lost'} his arbitration hearing: $${((playerWins ? pf : tf) / 1e6).toFixed(2)}M.`, [p.id]);
  }
}

// ---------- new season ----------

export function retire(league: League, p: Player): void {
  p.retired = league.season;
  p.orgId = null;
  touchRosters();
  p.level = null;
  p.on40 = false;
  p.fa = null;
  p.il = null;
  if (p.mlServiceDays === 0) delete league.players[p.id];
}

function runRollover(league: League): void {
  const prevSeason = league.season;
  const s = league.settings;

  // Retirements.
  let retired = 0;
  for (const p of Object.values(league.players)) {
    if (p.retired || p.prospect || p.ifa) continue;
    const a = prevSeason + 1 - p.born;
    const o = ovr(p);
    const fa = p.orgId === null;
    let prob = 0;
    if (a >= 41) prob = 0.95;
    else if (a >= 36 && o < 48) prob = 0.6;
    else if (a >= 34 && o < 42) prob = 0.6;
    else if (fa && a >= 30 && o < 40) prob = 0.7;
    else if (fa && a >= 26 && o < 38) prob = 0.75;
    else if (fa && p.mlServiceDays === 0 && o < 36) prob = 0.8;
    else if (fa && p.fa && league.day - p.fa.opened > 200 && o < 45) prob = 0.7;
    else if (!fa && p.level && ['A', 'A+', 'CPX', 'DSL'].includes(p.level) && a >= 26 && potOvr(p) < 40) prob = 0.5;
    if (rand() < prob) {
      if (p.orgId === league.userOrgId && p.mlServiceDays > s.serviceDaysPerYear) addNews(league, p.orgId, `${pname(p)} retired.`, [p.id]);
      retire(league, p);
      retired++;
    }
  }

  // CBT payer streaks.
  for (const org of league.orgs) {
    const rec = league.cbtHistory.find((r) => r.season === prevSeason && r.orgId === org.id);
    org.cbtPayerYears = rec && rec.cbt > s.cbtThreshold ? org.cbtPayerYears + 1 : 0;
    org.deadMoney = org.deadMoney.filter((d) => d.season > prevSeason);
  }

  pruneLeague(league);

  // For the season preview: ratings before winter development, and last summer's first round.
  // Compare against the start of last season (a full year of change).
  const preOvr = new Map<number, number>();
  if (league.ovrBaseline) for (const [id, v] of Object.entries(league.ovrBaseline.ovr)) preOvr.set(Number(id), v);
  else for (const p of Object.values(league.players)) if (!p.retired && p.orgId !== null && !p.prospect && !p.ifa) preOvr.set(p.id, ovr(p));
  const draftRecap = (league.draft?.picks ?? []).filter((pk) => pk.round === 1 && pk.pid !== null).map((pk) => ({ pick: pk.pick, orgId: pk.orgId, pid: pk.pid!, label: pk.label }));

  // New season.
  league.season = prevSeason + 1;
  const open = dayToDate(league.season, 0).getTime();
  const cur = dayToDate(prevSeason, league.day).getTime();
  league.day = Math.round((cur - open) / 86400000);
  league.phase = 'preseason';

  for (const p of Object.values(league.players)) {
    if (p.retired) continue;
    if (p.orgId !== null && !p.prospect && !p.ifa) p.proSeasons++;
    p.serviceThisSeason = 0;
    p.optionDaysThisSeason = 0;
    p.optionsThisSeason = 0;
    p.optionedOnDay = null;
    p.consecutiveDays = 0;
    p.lastPitchedDay = -99;
    p.lastStartDay = -99;
    p.lastPitchCount = 0;
    if (p.rule5 && p.rule5.season < league.season) p.rule5 = null;
    if (p.arb && p.arb.settled === null) p.arb.settled = p.arb.projected;
    if (p.contract.type === 'MiLB' && p.orgId !== null && p.contract.exp < league.season) p.contract.exp = league.season;
    syncContract(league, p);
    // Winter development: roughly three months' worth.
    if (!p.prospect) {
      yearlyPotentialDrift(league, p);
      for (let i = 0; i < 3; i++) developPlayer(league, p);
    } else if (p.prospect.year > league.season) {
      // In college: a full year of development before he's draft-eligible again.
      yearlyPotentialDrift(league, p);
      for (let i = 0; i < 9; i++) developPlayer(league, p);
    }
  }
  recenterRatings(league);
  // Keep the star pipeline steady: measured after the winter's aging and
  // recentering (what Opening Day looks like). If fewer than ~66 players on
  // 40-man rosters rate 60+, young players develop faster next year (slower if more).
  {
    const n60 = Object.values(league.players).filter((p) => p.orgId !== null && p.on40 && !p.retired && displayOvr(p, ovr(p)) >= 60).length;
    if (n60 > 0) league.devAdj = clamp((league.devAdj ?? 1) * clamp(Math.pow(66 / n60, 0.8), 0.85, 1.3), 0.85, 2);
  }

  league.schedule = buildSchedule(league.orgs, s, league.nextId.game);
  league.nextId.game += league.schedule.length;
  for (const level of LEVELS) for (const org of league.orgs) league.standings[level][org.id] = emptyStanding();
  league.boxScores = {};
  league.playoffs = null;
  league.draft = null;
  league.waiverClaims = {};
  league.lastFdRun = -99;
  league.lastDevDay = 0;
  league.transactions = league.transactions.filter((t) => t.season >= league.season - 2);
  for (const org of league.orgs) org.rotationIndex = {};
  staffContractsExpire(league);
  ownerSales(league);
  updateStrategies(league);
  setBudgets(league, (org) => orgPayroll(league, org).cbt);
  setDeptBudgets(league);
  setOwnerGoals(league);
  hallOfFameVote(league);
  generateDraftClass(league, league.season);
  generateCbPicks(league, league.season);
  // Who got better and who got worse over the winter (relative to everyone else).
  const changes = [...preOvr.entries()]
    .map(([pid, from]) => ({ pid, from, to: league.players[pid] && !league.players[pid].retired ? ovr(league.players[pid]) : NaN }))
    .filter((c) => !Number.isNaN(c.to));
  const deltas = changes.map((c) => c.to - c.from).sort((a, b) => a - b);
  const mid = deltas[Math.floor(deltas.length / 2)] ?? 0;
  const rel = (c: { from: number; to: number }) => c.to - c.from - mid;
  league.preview = {
    season: league.season,
    risers: changes.filter((c) => c.to >= 50).sort((a, b) => rel(b) - rel(a)).slice(0, 12),
    decliners: changes.filter((c) => c.from >= 50).sort((a, b) => rel(a) - rel(b)).slice(0, 12),
    draft: draftRecap,
    draftSeason: prevSeason,
  };
  setOvrBaseline(league);
  addNews(league, null, `Spring training has opened for the ${league.season} season. ${retired} players retired this winter. The season preview is out.`);
}

// ---------- free agency stages ----------

// Where the free agent market is right now (shown on the Free Agents page).
export function faStage(league: League): { stage: string; detail: string } | null {
  if (league.phase !== 'offseason') return null;
  const cal = offseasonCalendar(league);
  const at = (k: string) => cal.find((e) => e.key === k)!.day;
  const d = league.day;
  const when = (k: string) => dayShort(league.season, at(k));
  if (d < at('fa-open')) return { stage: 'Exclusive window', detail: `Clubs have their own free agents to themselves. The market opens ${when('fa-open')}.` };
  if (d < at('qo-response')) return { stage: 'Market open', detail: `Free agents are taking offers. Players with qualifying offers answer ${when('qo-response')}; the ones who decline join the market.` };
  if (d < at('winter-meetings')) return { stage: 'Main market', detail: `The whole class is out. Each player decides on his own timeline: some in days, most in a few weeks, some not until January. Winter Meetings ${when('winter-meetings')}.` };
  if (d < at('fa-late')) return { stage: 'Winter Meetings', detail: 'The busiest stretch: big signings and trades.' };
  return { stage: 'Late market', detail: `The remaining free agents are running out of time before spring training (${when('rollover')}); asking prices come down as the winter goes on.` };
}

// The class in one line: the best (by your scouts' read) and their asks.
function faHeadline(league: League, n = 6): string {
  const fas = Object.values(league.players).filter((p) => isFreeAgent(p) && p.fa && p.fa.asking.aav > 2e6).sort((a, b) => b.fa!.asking.aav - a.fa!.asking.aav);
  if (!fas.length) return 'No major league free agents of note are left.';
  return `${fas.length} notable free agent${fas.length === 1 ? '' : 's'}. Top asks: ${fas.slice(0, n).map((p) => `${posLabel(p)} ${pname(p)} (${p.fa!.asking.years} yr × ${fmtMoney(p.fa!.asking.aav)})`).join(', ')}.`;
}

// An inbox notice when the market moves to its next stage; returns a stop for the sim.
function faNotice(league: League, key: string): string | null {
  const st = faStage(league);
  const pending = Object.values(league.players).filter((p) => p.qoPending && p.orgId !== null);
  let subject = '', text = '';
  if (key === 'fa-open') {
    subject = 'Free agency is open';
    text = `${faHeadline(league)}${pending.length ? ` Still deciding on qualifying offers (they answer ${dayShort(league.season, offseasonCalendar(league).find((e) => e.key === 'qo-response')!.day)}): ${pending.map((p) => pname(p)).join(', ')}.` : ''}`;
  } else if (key === 'qo-response') {
    const today = league.transactions.filter((t) => t.season === league.season && t.day === league.day && t.text.includes('qualifying offer'));
    const declined = today.filter((t) => t.text.includes('declined')).map((t) => t.text.replace(' declined the qualifying offer and became a free agent', ''));
    const accepted = today.filter((t) => t.text.includes('accepted')).map((t) => t.text.replace(' accepted the qualifying offer', ''));
    subject = 'Qualifying offer decisions are in';
    text = `${declined.length ? `Declined and now free agents: ${declined.join(', ')}.` : 'Nobody declined.'}${accepted.length ? ` Accepted: ${accepted.join(', ')}.` : ''} The whole class is on the market now. ${faHeadline(league)}`;
  } else if (key === 'winter-meetings') {
    subject = 'The Winter Meetings are underway';
    text = `The trade market heats up and big free agents tend to sign this week. ${faHeadline(league)}`;
  } else if (key === 'fa-late') {
    subject = 'Late free agent market';
    text = `${faHeadline(league)} Asking prices keep coming down as spring training nears.`;
  } else return null;
  addInbox(league, { from: 'Front office', subject, kind: 'info', pids: [], stop: true, link: { page: 'free-agents' }, text: `${st ? `${st.stage}: ` : ''}${text}` }).stopped = true; // this return is the pause
  return `Inbox: ${subject}. ${st ? st.detail : ''}`;
}

// ---------- daily driver ----------

export function nextEvent(league: League): CalEvent | null {
  if (league.phase !== 'offseason') return null;
  return offseasonCalendar(league).find((e) => !league.events.includes(e.key)) ?? null;
}

// Runs any offseason events due today. Returns a stop message when the user
// has a decision to make first (only once per event).
export function runOffseasonEvents(league: League): string | null {
  if (league.phase !== 'offseason') return null;
  const user = league.orgs[league.userOrgId];
  for (const ev of offseasonCalendar(league)) {
    if (league.events.includes(ev.key) || league.day < ev.day) continue;
    if (ev.decision && !delegated(league, user, ev.decision.duty) && !league.events.includes(`prompt-${ev.key}`) && userHasDecision(league, ev.key)) {
      league.events.push(`prompt-${ev.key}`);
      return `${ev.label} today. ${ev.decision.text} Press Play again when you're ready.`;
    }
    league.events.push(ev.key);
    const txBefore = league.nextId.tx;
    const byAgm = !!ev.decision && delegated(league, user, ev.decision.duty) && !!staffOf(league, user, 'AGM');
    switch (ev.key) {
      case 'options': runOptions(league); break;
      case 'fa-open': runFaOpen(league); break;
      case 'qo-response': runQoResponses(league); break;
      case 'r5-protect': runProtection(league); break;
      case 'tender': runTenders(league); break;
      case 'winter-meetings': addNews(league, null, 'The Winter Meetings are underway. Expect the trade market to heat up.'); break;
      case 'fa-late': break;
      case 'r5-draft': runRule5Draft(league); break;
      case 'posting': postPlayers(league); break;
      case 'ifa-class':
        for (const p of Object.values(league.players)) if (isIfa(p) && p.ifa!.year !== league.season + 1) delete league.players[p.id];
        generateIfaClass(league, league.season + 1);
        setupIfaPools(league);
        if (!delegated(league, user, 'ifa')) return 'The international class is out and negotiations are open. Check asking ranges and make offers on the International page before signing day (January 15). Press Play again when you\'re ready.';
        break;
      case 'ifa-shake': negotiationDay(league); break;
      case 'arb-exchange': runArbExchange(league); break;
      case 'ifa-open': openIfaPeriod(league); break;
      case 'arb-hearings': runArbHearings(league); break;
      case 'rollover': runRollover(league); return null;
    }
    if (byAgm) agmReport(league, ev.label, txBefore);
    // Free agency moved to its next stage: tell the user (and pause).
    const faStop = faNotice(league, ev.key);
    if (faStop) return faStop;
  }
  return null;
}

// Your assistant GM tells you what he did with a job you gave him.
function agmReport(league: League, label: string, txBefore: number): void {
  const user = league.orgs[league.userOrgId];
  const agm = staffOf(league, user, 'AGM')!;
  const mine = league.transactions.filter((t) => t.id >= txBefore && t.orgId === user.id);
  const text = mine.length
    ? `AGM ${agm.first} ${agm.last} (${label.toLowerCase()}): ${mine.map((t) => t.text).join('; ')}.`
    : `AGM ${agm.first} ${agm.last} (${label.toLowerCase()}): no moves needed.`;
  addNews(league, user.id, text, mine.flatMap((t) => t.pids));
  addInbox(league, { from: `Assistant GM ${agm.first} ${agm.last}`, subject: label, kind: 'info', pids: mine.flatMap((t) => t.pids).slice(0, 20), text });
}

function userHasDecision(league: League, key: string): boolean {
  const id = league.userOrgId;
  switch (key) {
    case 'options': return pendingOptions(league, id).length + qoEligible(league, id).length > 0;
    case 'r5-protect': return orgPlayers(league, id).some((p) => rule5Eligible(league, p));
    case 'tender': return controlledExpiring(league, id).length > 0;
    case 'r5-draft': return fortyMan(league, id).length < league.settings.fortyMax;
    case 'arb-exchange':
    case 'arb-hearings': return orgPlayers(league, id).some((p) => p.arb && p.arb.settled === null);
  }
  return false;
}

export const isFa = isFreeAgent;
export { firstContractSeason };

// Snapshot of true overall for every organizational player, for next year's preview.
export function setOvrBaseline(league: League): void {
  const o: Record<number, number> = {};
  for (const p of Object.values(league.players)) if (!p.retired && p.orgId !== null && !p.prospect && !p.ifa) o[p.id] = Math.round(ovr(p) * 10) / 10;
  league.ovrBaseline = { season: league.season, ovr: o };
}

// Keeps saves small: retired players who never reached the majors, and
// free agents no club will ever sign, are removed.
export function pruneLeague(league: League): void {
  // Other clubs' transaction logs keep five seasons; yours is kept in full.
  const keepFrom = league.season - 5;
  league.transactions = league.transactions.filter((t) => t.season >= keepFrom || t.orgId === league.userOrgId || t.type === 'Trade');
  for (const p of Object.values(league.players)) {
    const mlb = p.stats.some((s) => s.level === 'MLB');
    if (p.retired && !mlb) delete league.players[p.id];
    else if (!p.retired && p.orgId === null && !p.prospect && !p.ifa && !mlb && league.season - p.born >= 26 && ovr(p) < 42) delete league.players[p.id];
    else {
      for (const e of p.stats) if (e.splits && e.season < league.season - 3) delete e.splits;
      // Minor league lines older than three seasons collapse to one line per season.
      const old = p.stats.filter((s) => s.level !== 'MLB' && s.season < league.season - 2);
      const seasons = new Set(old.map((s) => s.season));
      if (old.length <= seasons.size) continue;
      const merged = [...seasons].map((season) => {
        const es = old.filter((s) => s.season === season);
        const top = es.reduce((a, b) => (LEVELS.indexOf(b.level) < LEVELS.indexOf(a.level) ? b : a));
        return { season, level: top.level, orgId: top.orgId, bat: sumBat(es), pit: sumPit(es) };
      });
      p.stats = [...merged, ...p.stats.filter((s) => !old.includes(s))].sort((a, b) => a.season - b.season);
    }
  }
  touchRosters();
}
