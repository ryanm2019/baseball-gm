// Player valuation for trades: surplus value = projected production over the
// years of team control (in dollars, at $/WAR) minus salary, discounted, and
// seen through each club's situation (contending clubs weight this year,
// rebuilding clubs weight the future).
import type { League, Level, Org, Player } from './types.ts';
import { isPitcher, ovr, perceivedOvr, potOvr, scoutFactor } from './ratings.ts';
import { marketValue, serviceYears } from './contracts.ts';
import { agmEvalSd, staffOf } from './staff.ts';
import { orgPlayers } from './util.ts';

export const DOLLARS_PER_WAR = 8e6;
const DISCOUNT = 0.08;
const HORIZON = 7;

const RISK: Record<Level, number> = { MLB: 1, AAA: 0.85, AA: 0.72, 'A+': 0.58, A: 0.48, CPX: 0.4, DSL: 0.34 };
const YEARS_TO_MLB: Record<Level, number> = { MLB: 0, AAA: 0, AA: 1, 'A+': 2, A: 3, CPX: 4, DSL: 4 };

export function warFor(p: Player, o: number): number {
  if (p.pos === 'SP') return (o - 42) * 0.21;
  if (p.pos === 'RP') return (o - 42) * 0.075;
  return (o - 42) * 0.22;
}

function playingTime(o: number): number {
  return o >= 47 ? 1 : o >= 43 ? 0.5 : 0.1;
}

// How each club's front office sees a player: true rating plus that club's evaluation noise.
function evalOvr(league: League, org: Org, p: Player): number {
  const area = p.orgId === org.id ? 'own' : 'pro';
  const sd = org.id === league.userOrgId ? agmEvalSd(league, org) * scoutFactor(league, org, area) : (() => {
    const fd = staffOf(league, org, 'AGM') ?? staffOf(league, org, 'FD');
    return (fd ? Math.max(0, ((80 - fd.evaluation) / 60) * 4) : 4) * scoutFactor(league, org, area);
  })();
  return perceivedOvr(league, p, sd);
}

export function seasonFraction(league: League): number {
  if (league.phase === 'regular') return Math.max(0.05, (league.settings.seasonDays - league.day) / league.settings.seasonDays);
  return 1;
}

export interface ValueYear {
  season: number;
  ovr: number;
  war: number;
  salary: number;
  value: number;
}

export function projectValue(league: League, org: Org, p: Player): { total: number; years: ValueYear[] } {
  const s = league.settings;
  const start = league.phase === 'regular' || league.phase === 'playoffs' ? league.season : league.season + 1;
  const frac0 = seasonFraction(league);
  const cur0 = evalOvr(league, org, p);
  const pot0 = Math.max(cur0, potOvr(p) + (cur0 - ovr(p)));
  const level = p.level ?? 'AAA';
  const toMlb = p.on40 && p.level === 'MLB' ? 0 : YEARS_TO_MLB[level] ?? 2;
  const risk = RISK[level] ?? 0.6;
  const strategy = org.strategy;
  const weight = (t: number) =>
    strategy === 'Contend' ? (t === 0 ? 1.35 : t === 1 ? 1 : 0.75) : strategy === 'Rebuild' ? (t === 0 ? 0.5 : t === 1 ? 0.8 : 1.15) : 1;

  // Years of control and salary.
  const c = p.contract;
  let svc = serviceYears(p.mlServiceDays, s);
  let o = cur0;
  const years: ValueYear[] = [];
  let total = 0;
  for (let t = 0; t < HORIZON; t++) {
    const season = start + t;
    const age = season - p.born;
    if (t > 0) {
      if (age < 27) o += (pot0 - o) * 0.3;
      else if (age >= 31) o -= (age - 30) * 0.6;
    }
    const inMlb = t >= toMlb;
    let salary = 0;
    let controlled = true;
    if (c.type === 'ML' && season <= c.exp) salary = c.oneWay || inMlb ? c.salary : c.minorSalary;
    else if (c.type === 'ML' && c.option && season === c.option.season) salary = c.option.type === 'club' && o < 45 ? c.option.buyout : c.option.salary;
    else {
      // Beyond the contract: pre-arb / arbitration control until 6 years of service.
      const yrsToFa = 6 - svc;
      if (c.type === 'MiLB' && !inMlb) salary = 0;
      else if (yrsToFa <= 0) controlled = false;
      else if (svc < 3) salary = s.minSalary;
      else salary = marketValue({ ...p, ratings: p.ratings } as Player, s) * [0.25, 0.4, 0.6][Math.min(2, svc - 3)];
    }
    if (!controlled) break;
    const war = inMlb ? Math.max(-0.5, warFor(p, o)) * playingTime(o) : 0;
    const f = t === 0 ? frac0 : 1;
    const val = (war * DOLLARS_PER_WAR * weight(t) - salary) * f / Math.pow(1 + DISCOUNT, t);
    years.push({ season, ovr: o, war, salary, value: val });
    total += val;
    if (inMlb) svc++;
  }
  // Prospects carry risk; the downside of a bad contract is capped at releasing him.
  if (level !== 'MLB' && total > 0) total *= risk;
  const guaranteed = years.reduce((t, y) => t + (c.type === 'ML' && y.season <= c.exp ? y.salary : 0), 0);
  total = Math.max(total, -guaranteed);
  return { total, years };
}

// Value to a club, including position need and budget room.
export function tradeValue(league: League, org: Org, p: Player, receiving: boolean): number {
  let v = projectValue(league, org, p).total;
  if (receiving && v > 0) {
    // Less useful if he'd sit behind better players at his position.
    const depth = orgPlayers(league, org.id).filter((q) => q.level === 'MLB' && q.pos === p.pos && q !== p).map(ovr).sort((a, b) => b - a);
    const slot = isPitcher(p) ? (p.pos === 'SP' ? 4 : 6) : 0;
    if (p.level === 'MLB' && depth[slot] !== undefined && depth[slot] > ovr(p) + 3) v *= 0.85;
  }
  return v;
}

export const CB_VALUE = { A: 9e6, B: 5e6 };
export const POOL_VALUE = 0.6; // per dollar of international pool money
