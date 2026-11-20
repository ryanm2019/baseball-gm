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
import { cbtTax, marketValue, orgPayroll, roundSalary, serviceYears } from './contracts.ts';
import { isPitcher, ovr, perceivedOvr, potOvr } from './ratings.ts';
import { addNews, addTransaction, fortyMan, orgPlayers, pname, touchRosters } from './util.ts';
import { agmEvalSd, delegated, staffContractsExpire } from './staff.ts';
import { firstContractSeason, isFreeAgent, openFreeAgent } from './freeAgency.ts';
import { posLabel } from './rules.ts';
import { clamp, normal, rand } from './random.ts';
import { developPlayer, recenterRatings, yearlyPotentialDrift } from './development.ts';
import { buildSchedule } from './schedule.ts';
import { emptyStanding } from './league.ts';
import { generateDraftClass } from './draft.ts';
import { generateIfaClass, isIfa, openIfaPeriod } from './intl.ts';

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
    { key: 'r5-draft', label: 'Rule 5 draft', day: dayOfDate(league, 11, 10), decision: { duty: 'rule5draft', page: 'rule5', text: 'Pick your Rule 5 targets on the Rule 5 page.' } },
    { key: 'ifa-class', label: 'International class revealed', day: dayOfDate(league, 11, 15) },
    { key: 'arb-exchange', label: 'Arbitration figures exchanged', day: dayOfDate(league, 0, 9), decision: { duty: 'arbitration', page: 'tenders', text: 'Set your arbitration figures or settle on the Tenders & Arbitration page.' } },
    { key: 'ifa-open', label: 'International signing period opens', day: dayOfDate(league, 0, 15), decision: { duty: 'ifa', page: 'international', text: 'Sign international amateurs on the International page.' } },
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

function aiOfferQo(league: League, org: Org, p: Player, qo: number): boolean {
  void org;
  return marketValue(p, league.settings) >= qo * 0.85;
}

function runOptions(league: League): void {
  const qo = qoAmount(league);
  for (const org of league.orgs) {
    const auto = delegated(league, org, 'options');
    for (const p of pendingOptions(league, org.id)) {
      const opt = p.contract.option!;
      let exercise: boolean;
      if (opt.type === 'club') exercise = auto ? aiExercise(league, org, p) : (org.optionPlan[p.id] ?? aiExercise(league, org, p));
      else exercise = opt.salary >= marketValue(p, league.settings) * 0.95; // the player decides
      if (exercise) {
        p.contract = { ...p.contract, salary: opt.salary, exp: opt.season, option: undefined };
        addTransaction(league, org.id, 'Option', `${opt.type === 'club' ? 'Exercised the club option on' : 'Player option exercised by'} ${posLabel(p)} ${pname(p)} ($${(opt.salary / 1e6).toFixed(2)}M)`, [p.id]);
      } else {
        if (opt.type === 'club' && opt.buyout > 0) org.deadMoney.push({ pid: p.id, name: pname(p), amount: opt.buyout, season: league.season });
        p.contract = { ...p.contract, option: undefined };
        addTransaction(league, org.id, 'Option', `${opt.type === 'club' ? 'Declined the club option on' : 'Player declined his option:'} ${posLabel(p)} ${pname(p)}`, [p.id]);
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
    const accept = marketValue(p, league.settings) < qo * 0.82 || (league.season + 1 - p.born >= 35 && rand() < 0.5);
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
      pick.on40 = true;
      pick.level = 'MLB';
      pick.rule5 = { fromOrg: from, season: league.season + 1 };
      pick.contract = { type: 'ML', salary: league.settings.minSalary, minorSalary: league.settings.minorSalaryFirstML, exp: league.season + 1, oneWay: false, signed: league.season + 1 };
      taken++;
      addTransaction(league, orgId, 'Rule 5', `Selected ${posLabel(pick)} ${pname(pick)} from the ${league.orgs[from].affiliates.MLB.name} in the Rule 5 draft`, [pick.id]);
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
  const v = marketValue(p, league.settings) * frac;
  const prev = p.contract.salary;
  // Arbitration salaries can't be cut more than 20% and usually rise.
  return roundSalary(Math.max(league.settings.minSalary, prev * 0.8, Math.max(v, prev * (year > 1 ? 1.05 : 1))));
}

function aiTender(league: League, org: Org, p: Player, projected: number, arb: boolean): boolean {
  const v = perceivedOvr(league, p, agmEvalSd(league, org));
  if (!arb) return v >= 38 || potOvr(p) >= 48;
  const mv = marketValue(p, league.settings);
  return v >= 43 && projected <= mv * 1.1;
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

function retire(league: League, p: Player): void {
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
    // Winter development: roughly three months' worth.
    if (!p.prospect) {
      yearlyPotentialDrift(league, p);
      for (let i = 0; i < 3; i++) developPlayer(league, p);
    }
  }
  recenterRatings(league);

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
  generateDraftClass(league, league.season);
  addNews(league, null, `Spring training has opened for the ${league.season} season. ${retired} players retired this winter.`);
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
    switch (ev.key) {
      case 'options': runOptions(league); break;
      case 'fa-open': runFaOpen(league); break;
      case 'qo-response': runQoResponses(league); break;
      case 'r5-protect': runProtection(league); break;
      case 'tender': runTenders(league); break;
      case 'r5-draft': runRule5Draft(league); break;
      case 'ifa-class':
        for (const p of Object.values(league.players)) if (isIfa(p)) delete league.players[p.id];
        generateIfaClass(league, league.season + 1);
        break;
      case 'arb-exchange': runArbExchange(league); break;
      case 'ifa-open': openIfaPeriod(league); break;
      case 'arb-hearings': runArbHearings(league); break;
      case 'rollover': runRollover(league); return null;
    }
  }
  return null;
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
    case 'ifa-open': return true;
  }
  return false;
}

export const isFa = isFreeAgent;
export { firstContractSeason };
