// The league economy over time:
//  - Salaries inflate a little every year (about 3%, sometimes 2%, sometimes 4%).
//    Free agent prices, arbitration, budgets and media money all follow; the
//    MLB minimum steps up with it.
//  - Every three seasons a new CBA resets the luxury tax threshold to keep pace.
//  - Revenue sharing, like MLB's: each club puts 48% of its local revenue
//    (gate, merchandise, local media) into a pool split evenly. Big markets pay
//    in; small markets get a check, which shows up in their owners' budgets.
import type { League } from './types.ts';
import { addNews } from './util.ts';
import { addInbox } from './morale.ts';
import { clamp, normal } from './random.ts';
import { fmtMoney, roundSalary } from './contracts.ts';

export const salaryScale = (league: { settings: { salaryScale?: number } }): number => league.settings.salaryScale ?? 1;

export const SHARE_RATE = 0.48;
// How much of the revenue-sharing swing reaches payroll budgets (owners bank some of it).
const SHARE_TO_PAYROLL = 0.35;

// Each winter: inflation, a new minimum salary and, every third season, a new CBA.
export function yearlyEconomy(league: League): void {
  const s = league.settings;
  const g = clamp(normal(0.03, 0.01), 0.01, 0.05);
  s.salaryScale = Math.round(salaryScale(league) * (1 + g) * 10000) / 10000;
  s.minSalary = roundSalary(Math.max(s.minSalary, 780_000 * s.salaryScale));
  const seasonsIn = league.season - league.startYear + 1;
  if (seasonsIn % 3 === 0) {
    const prevScale = s.cbaScale ?? 1;
    const before = s.cbtThreshold;
    s.cbtThreshold = Math.round((s.cbtThreshold * s.salaryScale) / prevScale / 1e6) * 1e6;
    s.cbaScale = s.salaryScale;
    const text = `New collective bargaining agreement: the luxury tax threshold rises from ${fmtMoney(before)} to ${fmtMoney(s.cbtThreshold)} starting in ${league.season + 1}, and the minimum salary is now ${fmtMoney(s.minSalary)}. The next CBA comes in three years.`;
    addNews(league, null, text);
    addInbox(league, { from: 'Commissioner\'s office', subject: `New CBA: luxury tax threshold ${fmtMoney(s.cbtThreshold)}`, kind: 'info', pids: [], text });
  } else {
    addNews(league, null, `Salaries keep climbing: league economists expect about ${Math.round(g * 1000) / 10}% inflation in contracts next season. Minimum salary: ${fmtMoney(s.minSalary)}.`);
  }
}

// Net revenue-sharing transfer for a club given everyone's local revenue: + receives, - pays.
export function shareTransfer(locals: number[], mine: number): number {
  const avg = locals.reduce((t, x) => t + x, 0) / Math.max(1, locals.length);
  return SHARE_RATE * (avg - mine);
}

// Budget effect of revenue sharing: pulls each club's base budget part of the way toward the league average.
export function sharedBase(base: number, leagueAvgBase: number): number {
  return base + SHARE_RATE * SHARE_TO_PAYROLL * (leagueAvgBase - base);
}
