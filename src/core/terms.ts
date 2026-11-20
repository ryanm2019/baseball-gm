// Contract terms: year-by-year salaries, options (club / player / mutual /
// vesting) with buyouts, opt-outs, no-trade clauses and deferred money.
//
// contract.salary always holds the current season's salary (synced each
// spring from the schedule), so payroll code keeps working. CBT payroll uses
// contract.aav: the average annual value with deferred money discounted to
// present value, as in the CBA.
import type { Contract, ContractOption, League, Org, Player } from './types.ts';
import { fmtMoney, roundSalary } from './contracts.ts';

export interface Terms {
  sched: number[]; // salary for each guaranteed season, starting at `start`
  option?: ContractOption; // for the season after the last guaranteed one
  optOuts?: number[]; // seasons after which the player may opt out
  ntc?: 'full' | number[]; // full no-trade, or org ids he can block
  deferPct?: number; // 0-0.5 of each year's salary paid later (over 10 years after the deal ends)
}

export const DEFER_RATE = 0.05; // discount rate for deferred money
export const DEFER_YEARS = 10;

export type Structure = 'flat' | 'front' | 'back' | 'ramp';

// Spread a total over N years in a shape. 'ramp' grows ~20%/yr (arb-style).
export function shapeSchedule(total: number, years: number, shape: Structure): number[] {
  const w = Array.from({ length: years }, (_, i) => {
    if (shape === 'front') return 1.25 - (0.5 * i) / Math.max(1, years - 1);
    if (shape === 'back') return 0.75 + (0.5 * i) / Math.max(1, years - 1);
    if (shape === 'ramp') return Math.pow(1.2, i);
    return 1;
  });
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((x) => roundSalary((total * x) / sum));
}

export const total = (t: Terms) => t.sched.reduce((a, b) => a + b, 0);

// Present value (at signing) of the deferred part of the deal.
function deferredPv(t: Terms, rate: number): number {
  const d = t.deferPct ?? 0;
  if (!d) return 0;
  let pv = 0;
  const n = t.sched.length;
  t.sched.forEach((s) => {
    const per = (s * d) / DEFER_YEARS;
    for (let k = 0; k < DEFER_YEARS; k++) pv += per / Math.pow(1 + rate, n + k);
  });
  return pv;
}

// CBT average annual value: cash paid during the deal plus deferred money at
// present value, over the guaranteed years (club/vesting option buyouts are
// part of the guarantee).
export function cbtAav(t: Terms): number {
  const n = t.sched.length;
  const cash = total(t) * (1 - (t.deferPct ?? 0));
  const buyout = t.option && t.option.type !== 'player' ? t.option.buyout : 0;
  return roundSalary((cash + deferredPv(t, DEFER_RATE) + buyout) / n);
}

// What the deal is worth to the player, in today's dollars. `market` is his
// open-market value per year, used to price the options and opt-outs.
export function playerValue(t: Terms, market: number, opts: { loyalty?: number; age?: number } = {}): number {
  const n = t.sched.length;
  let v = total(t) * (1 - (t.deferPct ?? 0)) + deferredPv(t, 0.07); // players discount deferrals a bit harder
  const o = t.option;
  // Option years are worth only what they add over hitting the market that
  // year: the buyout for club and mutual options (the club exercises only when
  // he's underpaid), a little more if it can vest, and insurance for a player
  // option.
  if (o) {
    const upside = Math.max(0, o.salary - o.buyout);
    if (o.type === 'club' || o.type === 'mutual') v += o.buyout;
    else if (o.type === 'vesting') v += o.buyout + 0.12 * upside;
    else v += 0.15 * Math.max(o.salary, market * 0.5);
  }
  // An opt-out is a free option on his own market: worth more to younger players.
  const young = opts.age !== undefined ? Math.max(0.5, Math.min(1.5, (34 - opts.age) / 5)) : 1;
  for (const s of t.optOuts ?? []) {
    const left = t.sched.length - (s + 1);
    if (left > 0) v += 0.06 * young * market * left;
  }
  if (t.ntc === 'full') v += 0.03 * total(t) * (1 + ((opts.loyalty ?? 50) - 50) / 60);
  else if (Array.isArray(t.ntc) && t.ntc.length) v += 0.003 * t.ntc.length * total(t);
  void n;
  return v;
}

// opt-outs are stored as indices into the schedule (after year i+1); convert
// to seasons on the contract.
export function buildContract(t: Terms, start: number, signed: number): Contract {
  const n = t.sched.length;
  const c: Contract = {
    type: 'ML',
    salary: t.sched[0],
    minorSalary: 0,
    exp: start + n - 1,
    oneWay: true,
    signed,
    start,
    sched: [...t.sched],
    aav: cbtAav(t),
  };
  if (t.option) c.option = { ...t.option, season: start + n };
  if (t.optOuts?.length) c.optOuts = t.optOuts.map((i) => start + i);
  if (t.ntc) c.ntc = t.ntc;
  if (t.deferPct) c.deferPct = t.deferPct;
  return c;
}

export function flatTerms(years: number, aav: number): Terms {
  return { sched: Array.from({ length: years }, () => roundSalary(aav)) };
}

// This season's salary under a contract.
export function salaryIn(c: Contract, season: number): number {
  if (c.sched && c.start !== undefined) {
    const i = season - c.start;
    if (i >= 0 && i < c.sched.length) return c.sched[i];
    return 0;
  }
  return season <= c.exp ? c.salary : 0;
}

// Each spring: the salary moves to this year's number; deferred money owed
// from the deal is booked to the club for the years after it ends.
export function syncContract(league: League, p: Player): void {
  const c = p.contract;
  if (c.type !== 'ML' || !c.sched || c.start === undefined) return;
  const s = salaryIn(c, league.season);
  if (s) c.salary = s;
}

export function bookDeferred(org: Org, p: Player, c: Contract): void {
  if (!c.deferPct || !c.sched || c.start === undefined) return;
  const tot = c.sched.reduce((a, b) => a + b, 0) * c.deferPct;
  org.deferred ??= [];
  for (let k = 0; k < DEFER_YEARS; k++) org.deferred.push({ pid: p.id, name: `${p.first} ${p.last}`, season: c.exp + 1 + k, amount: roundSalary(tot / DEFER_YEARS) });
}

const OPT_NAME: Record<ContractOption['type'], string> = { club: 'club option', player: 'player option', mutual: 'mutual option', vesting: 'vesting option' };

export function optionText(o: ContractOption): string {
  const vest = o.type === 'vesting' && o.vest ? `, vests at ${o.vest.need} ${o.vest.stat === 'pa' ? 'PA' : o.vest.stat === 'ip' ? 'IP' : 'appearances'}` : '';
  return `${o.season} ${OPT_NAME[o.type]} ${fmtMoney(o.salary)}${o.buyout ? ` (${fmtMoney(o.buyout)} buyout)` : ''}${vest}`;
}

export function describeContract(league: League, c: Contract): string {
  if (c.type !== 'ML') return 'Minor league contract';
  const parts: string[] = [];
  const years = c.sched?.length ?? Math.max(1, c.exp - c.signed + 1);
  const tot = c.sched ? c.sched.reduce((a, b) => a + b, 0) : c.salary * years;
  parts.push(`${years} yr${years === 1 ? '' : 's'}, ${fmtMoney(tot)} through ${c.exp}`);
  if (c.sched && new Set(c.sched).size > 1) parts.push(c.sched.map((s, i) => `${(c.start ?? 0) + i}: ${fmtMoney(s)}`).join(' · '));
  if (c.option) parts.push(optionText(c.option));
  if (c.optOuts?.length) parts.push(`opt-out after ${c.optOuts.join(', ')}`);
  if (c.ntc === 'full') parts.push('full no-trade clause');
  else if (Array.isArray(c.ntc) && c.ntc.length) parts.push(`partial no-trade (${c.ntc.length} teams: ${c.ntc.map((id) => league.orgs[id].abbrev).join(', ')})`);
  if (c.deferPct) parts.push(`${Math.round(c.deferPct * 100)}% deferred`);
  if (c.aav !== undefined) parts.push(`CBT AAV ${fmtMoney(c.aav)}`);
  return parts.join(' · ');
}

// Can this player block a trade to that club?
export function ntcBlocks(p: Player, toOrg: number): boolean {
  const n = p.contract.ntc;
  return n === 'full' || (Array.isArray(n) && n.includes(toOrg));
}
