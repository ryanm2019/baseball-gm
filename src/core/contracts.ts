// Contracts, service time, payroll and luxury tax (CBT).
import type { League, Level, Org, Player, Settings } from './types.ts';
import { clamp, normal, rand, randInt } from './random.ts';
import { ovr } from './ratings.ts';

export const MILB_SALARY: Record<Level, number> = {
  MLB: 0,
  AAA: 35_800,
  AA: 17_500,
  'A+': 15_400,
  A: 13_800,
  CPX: 6_000,
  DSL: 4_000,
};

export function serviceYears(days: number, s: Settings): number {
  return Math.floor(days / s.serviceDaysPerYear);
}

// MLB format, e.g. 3.112 = 3 years, 112 days.
export function serviceLabel(days: number, s: Settings): string {
  const y = Math.floor(days / s.serviceDaysPerYear);
  const d = days - y * s.serviceDaysPerYear;
  return `${y}.${String(d).padStart(3, '0')}`;
}

// Rough free-agent market value per year, by overall.
// o: the overall the market uses (defaults to true ratings; arbitration and
// free agency pass one blended with recent stats).
export function marketValue(p: Player, s: Settings, o = ovr(p)): number {
  const sig = 1 / (1 + Math.exp(-(o - 58) / 6));
  let v = 0.78e6 + 45e6 * sig;
  if (p.pos === 'RP') v *= 0.55;
  return Math.max(s.minSalary, v);
}

export function roundSalary(x: number): number {
  if (x >= 10e6) return Math.round(x / 250_000) * 250_000;
  if (x >= 1e6) return Math.round(x / 50_000) * 50_000;
  return Math.round(x / 5_000) * 5_000;
}

export type ServiceClass = 'Pre-Arb' | 'Arb 1' | 'Arb 2' | 'Arb 3' | 'Arb 4' | 'FA eligible';

export function serviceClass(p: Player, s: Settings): ServiceClass {
  const y = serviceYears(p.mlServiceDays, s);
  if (y >= 6) return 'FA eligible';
  if (y >= 3) return (['Arb 1', 'Arb 2', 'Arb 3'] as const)[y - 3];
  return 'Pre-Arb';
}

// Contracts for players that exist when a new league is created.
export function initialMLContract(p: Player, season: number, s: Settings): void {
  const years = serviceYears(p.mlServiceDays, s);
  const value = marketValue(p, s);
  if (years < 3) {
    const sal = s.minSalary * (1 + years * 0.04 + rand() * 0.03);
    p.contract = {
      type: 'ML',
      salary: roundSalary(sal),
      minorSalary: p.mlServiceDays > 0 ? s.minorSalarySecondML : s.minorSalaryFirstML,
      exp: season,
      oneWay: false,
      signed: season,
    };
    // Some young players already signed extensions.
    if (years >= 1 && ovr(p) > 55 && rand() < 0.25) {
      p.contract.salary = roundSalary(value * 0.35);
      p.contract.exp = season + randInt(3, 6);
      p.contract.oneWay = true;
    }
  } else if (years < 6) {
    const frac = [0.25, 0.4, 0.6][years - 3];
    p.contract = {
      type: 'ML',
      salary: roundSalary(Math.max(s.minSalary, value * frac * clamp(normal(1, 0.15), 0.7, 1.4))),
      minorSalary: 0,
      exp: season + (rand() < 0.2 ? randInt(1, 4) : 0),
      oneWay: true,
      signed: season,
    };
  } else {
    // Veteran free-agent deals, signed in the past at varying prices.
    const len = ovr(p) > 60 ? randInt(1, 6) : ovr(p) > 50 ? randInt(0, 3) : randInt(0, 1);
    p.contract = {
      type: 'ML',
      salary: roundSalary(Math.max(s.minSalary, value * clamp(normal(1, 0.3), 0.4, 1.8))),
      minorSalary: 0,
      exp: season + len,
      oneWay: true,
      signed: season - randInt(0, 4),
    };
  }
}

export function milbContract(p: Player, season: number, level: Level): void {
  p.contract = {
    type: 'MiLB',
    salary: MILB_SALARY[level],
    minorSalary: MILB_SALARY[level],
    exp: season,
    oneWay: false,
    signed: season,
  };
}

export interface PayrollLine {
  pid: number;
  name: string;
  level: Level | null;
  status: string;
  salary: number;
  cbt: number;
  exp: number;
}

// Projected full-season amounts for a 40-man player. Split contracts count the
// MLB rate for days on the MLB roster/IL and the minor league rate otherwise.
function projectedSplit(league: League, p: Player): number {
  const s = league.settings;
  const c = p.contract;
  if (c.oneWay) return c.salary;
  const remaining = Math.max(0, s.seasonDays - league.day);
  const inMlb = p.level === 'MLB' || (p.il !== null && p.il.type.startsWith('IL'));
  const mlbDays = Math.min(s.seasonDays, p.serviceThisSeason + (inMlb ? remaining : 0));
  const f = mlbDays / s.seasonDays;
  return c.salary * f + c.minorSalary * (1 - f);
}

export function orgPayroll(league: League, org: Org): { lines: PayrollLine[]; total: number; cbt: number; dead: number } {
  const lines: PayrollLine[] = [];
  let total = 0;
  for (const p of Object.values(league.players)) {
    if (p.orgId !== org.id || p.contract.type !== 'ML') continue;
    const amt = projectedSplit(league, p);
    lines.push({
      pid: p.id,
      name: `${p.first} ${p.last}`,
      level: p.level,
      status: p.on40 ? (p.level === 'MLB' ? 'Active' : 'Optioned') : 'Off 40',
      salary: p.contract.salary,
      cbt: amt,
      exp: p.contract.exp,
    });
    total += amt;
  }
  let dead = 0;
  for (const d of org.deadMoney) if (d.season === league.season) dead += d.amount;
  // Cash sent (+) or received (-) in trades counts against this season's payroll.
  for (const c of org.cash ?? []) if (c.season === league.season) dead += c.amount;
  lines.sort((a, b) => b.salary - a.salary);
  const cbt = total + dead + league.settings.playerBenefits;
  return { lines, total: total + dead, cbt, dead };
}

export function cbtTax(cbtPayroll: number, payerYears: number, s: Settings): { over: number; tax: number; tier: number } {
  const over = cbtPayroll - s.cbtThreshold;
  if (over <= 0) return { over, tax: 0, tier: 0 };
  const base = s.cbtBaseRates[Math.min(payerYears, s.cbtBaseRates.length - 1)];
  let tax = over * base;
  let tier = 1;
  for (let i = 0; i < s.cbtSurcharges.length; i++) {
    const lo = s.cbtTierStep * (i + 1);
    if (over > lo) {
      tier = i + 2;
      const hi = i + 1 < s.cbtSurcharges.length ? s.cbtTierStep * (i + 2) : Infinity;
      // Repeat payors pay a higher third-tier surcharge (45% vs 42.5%).
      const rate = s.cbtSurcharges[i] + (i === 1 && payerYears > 0 ? 0.025 : 0);
      tax += (Math.min(over, hi) - lo) * rate;
    }
  }
  return { over, tax, tier };
}

export function fmtMoney(x: number): string {
  const sign = x < 0 ? '-' : '';
  const a = Math.abs(x);
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 1e8 ? 1 : 2)}M`;
  if (a >= 1e3) return `${sign}$${Math.round(a / 1e3)}k`;
  return `${sign}$${Math.round(a)}`;
}
