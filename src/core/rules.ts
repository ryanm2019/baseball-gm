// Roster rules and transactions: options, recalls, contract selections, DFA,
// waivers, outright assignments, releases, the injured list and free agents.
// Every action has a matching can*() check that returns a reason string when
// the move is not allowed, so the UI can show why.
import type { IlStatus, League, Level, Player } from './types.ts';
import { MINOR_LEVELS } from './types.ts';
import { activeAt, activeLimit, addNews, addTransaction, countPitchers, fortyMan, orgById, pitcherLimit, pname, touchRosters } from './util.ts';
import { isPitcher, ovr } from './ratings.ts';
import { MILB_SALARY, roundSalary, serviceYears } from './contracts.ts';
import { rand } from './random.ts';
import { firstContractSeason, openFreeAgent } from './freeAgency.ts';
import { logMove, side } from './moves.ts';

const lvlName = (league: League, orgId: number, level: Level) => orgById(league, orgId)?.affiliates[level].name ?? level;

// ---------- checks ----------

export function optionYearAvailable(league: League, p: Player): boolean {
  const s = league.settings;
  // Once an option year has been charged this season, further options are free.
  if (p.optionDaysThisSeason >= s.optionDaysToUseYear) return true;
  // A fourth option year goes to players who used all three before completing five pro seasons.
  const fourth = p.optionsUsed >= s.optionYears && p.proSeasons < 5 ? 1 : 0;
  return p.optionsUsed < s.optionYears + fourth;
}

export function canOption(league: League, p: Player): string | null {
  const s = league.settings;
  if (!p.on40) return 'Not on the 40-man roster';
  if (p.level !== 'MLB') return 'Not on the MLB roster';
  if (p.il) return 'On the injured list';
  if (p.rule5 && p.rule5.season === league.season) return 'Rule 5 pick: must stay on the MLB roster (DFA to offer him back)';
  if (!optionYearAvailable(league, p)) return 'Out of options';
  if (p.optionsThisSeason >= s.maxOptionsPerSeason) return `Already optioned ${s.maxOptionsPerSeason} times this season`;
  if (serviceYears(p.mlServiceDays, s) >= s.optionConsentServiceYears) return `${s.optionConsentServiceYears}+ years of service: cannot be optioned without consent`;
  return null;
}

export function minStayDays(league: League, p: Player): number {
  return isPitcher(p) ? league.settings.optionMinStayPitcher : league.settings.optionMinStayPosition;
}

export function canRecall(league: League, p: Player, replacingInjured = false): string | null {
  if (!p.on40) return 'Not on the 40-man roster';
  if (p.level === 'MLB') return 'Already on the MLB roster';
  if (p.il) return 'On the injured list';
  if (p.injury) return 'Injured';
  if (p.dfa || p.waivers) return 'Designated / on waivers';
  if (!replacingInjured && p.optionedOnDay !== null) {
    const left = minStayDays(league, p) - (league.day - p.optionedOnDay);
    if (left > 0) return `Must stay down ${left} more day${left === 1 ? '' : 's'} (unless replacing an injured player)`;
  }
  return mlbRoomCheck(league, p);
}

function mlbRoomCheck(league: League, p: Player): string | null {
  if (p.orgId === null) return 'Free agent';
  const active = activeAt(league, p.orgId, 'MLB');
  if (active.length >= activeLimit(league)) return `MLB roster is full (${activeLimit(league)})`;
  if (isPitcher(p) && countPitchers(active) >= pitcherLimit(league)) return `Pitcher limit reached (${pitcherLimit(league)})`;
  return null;
}

export function canSelect(league: League, p: Player): string | null {
  if (p.on40) return 'Already on the 40-man roster';
  if (p.orgId === null) return 'Free agent';
  if (p.il || p.injury) return 'Injured';
  if (p.dfa || p.waivers) return 'On waivers';
  if (fortyMan(league, p.orgId).length >= league.settings.fortyMax) return '40-man roster is full';
  return mlbRoomCheck(league, p);
}

export function canAdd40(league: League, p: Player): string | null {
  if (p.on40) return 'Already on the 40-man roster';
  if (p.orgId === null) return 'Free agent';
  if (p.dfa || p.waivers) return 'On waivers';
  if (fortyMan(league, p.orgId).length >= league.settings.fortyMax) return '40-man roster is full';
  return null;
}

export function canDfa(_league: League, p: Player): string | null {
  if (!p.on40) return 'Not on the 40-man roster';
  if (p.dfa || p.waivers) return 'Already designated';
  return null;
}

export function canAssign(league: League, p: Player, level: Level): string | null {
  if (level === 'MLB') return 'Use recall or select contract';
  if (p.level === 'MLB') return p.on40 ? 'Use option' : 'Use DFA / outright';
  if (p.il) return 'On the injured list';
  if (p.dfa || p.waivers) return 'On waivers';
  if (p.level === level) return 'Already there';
  if (p.orgId === null) return 'Free agent';
  const n = activeAt(league, p.orgId, level).length;
  if (n >= league.settings.milbActiveMax[level]) return `${level} roster is full (${league.settings.milbActiveMax[level]})`;
  return null;
}

export function canPlaceIL(_league: League, p: Player): string | null {
  if (p.il) return 'Already on the IL';
  if (!p.injury) return 'Not injured';
  return null;
}

export function canActivate(league: League, p: Player): string | null {
  if (!p.il) return 'Not on the IL';
  if (p.injury) return `Still injured (${p.injury.daysLeft} days)`;
  const s = league.settings;
  const min = p.il.type === 'IL60' ? s.il60Days : p.il.type === 'IL15' ? s.il15Days : p.il.type === 'IL10' ? s.il10Days : p.il.type === 'MiLB60' ? 60 : 7;
  const served = league.day - p.il.since;
  if (served < min) return `Minimum stay: ${min - served} more day${min - served === 1 ? '' : 's'}`;
  if (p.il.type === 'IL60' && p.orgId !== null && fortyMan(league, p.orgId).length >= s.fortyMax) return '40-man roster is full';
  if (p.il.returnLevel === 'MLB') return mlbRoomCheck(league, p);
  return null;
}

// ---------- actions ----------

export function optionPlayer(league: League, p: Player, level: Level = 'AAA'): void {
  p.level = level;
  p.optionedOnDay = league.day;
  p.optionsThisSeason++;
  addTransaction(league, p.orgId, 'Option', `Optioned ${isPitcher(p) ? 'RHP/LHP' : p.pos} ${pname(p)} to ${lvlName(league, p.orgId!, level)}`.replace('RHP/LHP', p.throws === 'L' ? 'LHP' : 'RHP'), [p.id]);
}

export function recallPlayer(league: League, p: Player): void {
  const from = p.level!;
  p.level = 'MLB';
  addTransaction(league, p.orgId, 'Recall', `Recalled ${posLabel(p)} ${pname(p)} from ${lvlName(league, p.orgId!, from)}`, [p.id]);
}

export function posLabel(p: Player): string {
  if (isPitcher(p)) return p.throws === 'L' ? 'LHP' : 'RHP';
  return p.pos;
}

function toMLContract(league: League, p: Player): void {
  const s = league.settings;
  if (p.contract.type === 'ML') return;
  p.contract = {
    type: 'ML',
    salary: s.minSalary,
    minorSalary: p.mlServiceDays > 0 ? s.minorSalarySecondML : s.minorSalaryFirstML,
    exp: firstContractSeason(league),
    oneWay: false,
    signed: firstContractSeason(league),
  };
}

export function selectContract(league: League, p: Player): void {
  const from = p.level!;
  p.on40 = true;
  toMLContract(league, p);
  p.level = 'MLB';
  addTransaction(league, p.orgId, 'Select', `Selected the contract of ${posLabel(p)} ${pname(p)} from ${lvlName(league, p.orgId!, from)}`, [p.id]);
}

export function addTo40(league: League, p: Player): void {
  p.on40 = true;
  toMLContract(league, p);
  addTransaction(league, p.orgId, '40-man', `Added ${posLabel(p)} ${pname(p)} to the 40-man roster`, [p.id]);
}

export function designate(league: League, p: Player): void {
  p.on40 = false;
  p.dfa = { day: league.day };
  addTransaction(league, p.orgId, 'DFA', `Designated ${posLabel(p)} ${pname(p)} for assignment`, [p.id]);
}

export function placeOnWaivers(league: League, p: Player, type: 'outright' | 'release'): void {
  p.dfa = null;
  p.on40 = false;
  p.waivers = { day: league.day, fromOrg: p.orgId!, type };
  addTransaction(league, p.orgId, 'Waivers', `Placed ${posLabel(p)} ${pname(p)} on ${type === 'release' ? 'release' : 'outright'} waivers`, [p.id]);
}

export function assignPlayer(league: League, p: Player, level: Level, by?: string): void {
  const from = p.level;
  p.level = level;
  // AI clubs' minor-league shuffles are not logged, to keep the transaction log readable.
  const quiet = p.orgId !== league.userOrgId && from !== 'MLB' && level !== 'MLB';
  if (by !== 'silent' && !quiet) {
    const verb = from && MINOR_LEVELS.indexOf(level) < MINOR_LEVELS.indexOf(from) ? 'Promoted' : 'Assigned';
    addTransaction(league, p.orgId, 'Assign', `${verb} ${posLabel(p)} ${pname(p)} to ${lvlName(league, p.orgId!, level)}${by ? ` (${by})` : ''}`, [p.id]);
  }
}

export function placeIL(league: League, p: Player): void {
  const level = p.level ?? 'AAA';
  const days = p.injury?.daysLeft ?? 10;
  let type: IlStatus['type'];
  if (level === 'MLB') type = days > 55 ? 'IL60' : isPitcher(p) ? 'IL15' : 'IL10';
  else type = days > 55 ? 'MiLB60' : 'MiLB7';
  p.il = { type, since: league.day, returnLevel: level };
  const label = type === 'IL60' ? '60-day IL' : type === 'IL15' ? '15-day IL' : type === 'IL10' ? '10-day IL' : type === 'MiLB60' ? 'minor league 60-day IL' : 'minor league 7-day IL';
  addTransaction(league, p.orgId, 'IL', `Placed ${posLabel(p)} ${pname(p)} on the ${label} (${p.injury?.name ?? 'injury'})`, [p.id]);
}

export function activateFromIL(league: League, p: Player): void {
  const il = p.il!;
  p.il = null;
  p.level = il.returnLevel;
  addTransaction(league, p.orgId, 'Activate', `Activated ${posLabel(p)} ${pname(p)} from the injured list`, [p.id]);
}

function remainingOwed(league: League, p: Player): number {
  const s = league.settings;
  if (p.contract.type !== 'ML') return 0;
  const frac = Math.max(0, (s.seasonDays - league.day) / s.seasonDays);
  const thisYear = (p.contract.oneWay ? p.contract.salary : p.level === 'MLB' ? p.contract.salary : p.contract.minorSalary) * frac;
  return thisYear;
}

export function makeFreeAgent(league: League, p: Player, reason: string): void {
  const org = orgById(league, p.orgId);
  const former = p.orgId;
  if (org && p.contract.type === 'ML') {
    const owed = remainingOwed(league, p);
    if (owed > 0) org.deadMoney.push({ pid: p.id, name: pname(p), amount: owed, season: league.season });
    for (let y = league.season + 1; y <= p.contract.exp; y++) {
      org.deadMoney.push({ pid: p.id, name: pname(p), amount: p.contract.salary, season: y });
    }
  }
  if (org) addTransaction(league, org.id, 'Release', `${reason} ${posLabel(p)} ${pname(p)}`, [p.id]);
  p.orgId = null;
  touchRosters();
  p.level = null;
  p.on40 = false;
  p.dfa = null;
  p.waivers = null;
  p.il = null;
  p.optionedOnDay = null;
  p.rule5 = null;
  openFreeAgent(league, p, former);
}

export function releasePlayer(league: League, p: Player): void {
  if (p.contract.type === 'ML') {
    placeOnWaivers(league, p, 'release');
  } else {
    makeFreeAgent(league, p, 'Released');
  }
}

export function signFreeAgent(league: League, p: Player, orgId: number, level: Level, mlDeal: boolean): string | null {
  const s = league.settings;
  if (p.orgId !== null) return 'Not a free agent';
  if (mlDeal) {
    if (fortyMan(league, orgId).length >= s.fortyMax) return '40-man roster is full';
    const active = activeAt(league, orgId, 'MLB');
    if (active.length >= activeLimit(league)) return 'MLB roster is full';
    if (isPitcher(p) && countPitchers(active) >= pitcherLimit(league)) return 'Pitcher limit reached';
    p.orgId = orgId;
    touchRosters();
    p.on40 = true;
    p.level = 'MLB';
    p.contract = { type: 'ML', salary: s.minSalary, minorSalary: s.minorSalarySecondML, exp: league.season, oneWay: false, signed: league.season };
    p.fa = null;
    addTransaction(league, orgId, 'Sign', `Signed ${posLabel(p)} ${pname(p)} to a major league contract`, [p.id]);
    return null;
  }
  if (level === 'MLB') return 'Minor league deals go to an affiliate';
  if (activeAt(league, orgId, level).length >= s.milbActiveMax[level]) return `${level} roster is full`;
  p.orgId = orgId;
  touchRosters();
  p.teamSince = league.season;
  p.joined = { season: league.season, day: league.day };
  p.on40 = false;
  p.level = level;
  p.contract = { type: 'MiLB', salary: MILB_SALARY[level], minorSalary: MILB_SALARY[level], exp: league.season, oneWay: false, signed: league.season };
  p.fa = null;
  addTransaction(league, orgId, 'Sign', `Signed ${posLabel(p)} ${pname(p)} to a minor league contract, assigned to ${lvlName(league, orgId, level)}`, [p.id]);
  return null;
}

// ---------- waivers ----------

function winPct(league: League, orgId: number): number {
  const r = league.standings.MLB[orgId];
  const g = r.w + r.l;
  return g ? r.w / g : 0.5;
}

export function aiWantsClaim(league: League, orgId: number, p: Player): boolean {
  const forty = fortyMan(league, orgId);
  if (forty.length >= league.settings.fortyMax) return false;
  const value = ovr(p);
  const worst = Math.min(...forty.map(ovr));
  if (value < worst + 3) return false;
  // Expensive contracts get claimed far less often.
  const cost = p.contract.type === 'ML' ? p.contract.salary : 0;
  if (cost > 8e6 && rand() < 0.85) return false;
  if (!optionYearAvailable(league, p)) {
    const active = activeAt(league, orgId, 'MLB');
    if (active.length >= activeLimit(league)) return false;
  }
  return rand() < 0.7;
}

export function waiverClaims(league: League): Record<number, number[]> {
  return (league.waiverClaims ??= {});
}

export function resolveWaivers(league: League, p: Player): void {
  const w = p.waivers!;
  const from = w.fromOrg;
  const order = league.orgs.map((o) => o.id).filter((id) => id !== from).sort((a, b) => winPct(league, a) - winPct(league, b));
  const userClaims = waiverClaims(league)[p.id] ?? [];
  let claimer: number | null = null;
  for (const id of order) {
    if (id === league.userOrgId) {
      if (userClaims.includes(id) && fortyMan(league, id).length < league.settings.fortyMax) {
        claimer = id;
        break;
      }
    } else if (aiWantsClaim(league, id, p)) {
      claimer = id;
      break;
    }
  }
  delete waiverClaims(league)[p.id];
  if (claimer !== null) {
    const fromName = orgById(league, from)?.affiliates.MLB.name ?? '';
    p.orgId = claimer;
    touchRosters();
    p.teamSince = league.season;
    p.joined = { season: league.season, day: league.day };
    p.on40 = true;
    p.waivers = null;
    p.dfa = null;
    p.optionedOnDay = null;
    const active = activeAt(league, claimer, 'MLB');
    if (optionYearAvailable(league, p) && (active.length >= activeLimit(league) || claimer !== league.userOrgId)) {
      p.level = active.length < activeLimit(league) && ovr(p) > Math.min(...active.map(ovr)) ? 'MLB' : 'AAA';
    } else {
      p.level = 'MLB';
    }
    addTransaction(league, claimer, 'Claim', `Claimed ${posLabel(p)} ${pname(p)} off waivers from the ${fromName}`, [p.id]);
    logMove(league, 'Waiver claim', [side(claimer, [p.id]), side(from, [])], `${orgById(league, claimer)!.abbrev} claimed ${posLabel(p)} ${pname(p)} from ${orgById(league, from)!.abbrev}`, p.contract.type === 'ML' ? p.contract.salary : 0);
    if (claimer === league.userOrgId || from === league.userOrgId) addNews(league, claimer, `${pname(p)} was claimed off waivers by the ${orgById(league, claimer)!.affiliates.MLB.name}.`, [p.id]);
    return;
  }
  // Cleared waivers.
  if (p.rule5 && p.rule5.season === league.season) {
    const back = p.rule5.fromOrg;
    p.orgId = back;
    touchRosters();
    p.on40 = false;
    p.waivers = null;
    p.dfa = null;
    p.rule5 = null;
    p.level = 'AAA';
    p.contract = { type: 'MiLB', salary: MILB_SALARY.AAA, minorSalary: MILB_SALARY.AAA, exp: league.season, oneWay: false, signed: league.season };
    addTransaction(league, from, 'Rule 5', `Rule 5 pick ${posLabel(p)} ${pname(p)} cleared waivers and was returned to the ${orgById(league, back)!.affiliates.MLB.name}`, [p.id]);
    return;
  }
  if (w.type === 'release') {
    makeFreeAgent(league, p, 'Released');
    return;
  }
  const s = league.settings;
  const canRefuse = serviceYears(p.mlServiceDays, s) >= s.outrightRefuseServiceYears || p.outrightedBefore;
  if (canRefuse && rand() < 0.65) {
    makeFreeAgent(league, p, 'Released (elected free agency after clearing waivers)');
    if (from === league.userOrgId) addNews(league, from, `${pname(p)} cleared waivers and elected free agency.`, [p.id]);
    return;
  }
  p.waivers = null;
  p.dfa = null;
  p.on40 = false;
  p.outrightedBefore = true;
  p.level = 'AAA';
  addTransaction(league, from, 'Outright', `Outrighted ${posLabel(p)} ${pname(p)} to ${lvlName(league, from, 'AAA')}`, [p.id]);
}

export function roundMoney(x: number): number {
  return roundSalary(x);
}
