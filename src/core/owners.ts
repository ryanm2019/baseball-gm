// Owners, payroll budgets and team strategy (contend / retool / rebuild).
import type { League, Org, Owner, OwnerGoal, OwnerType, Strategy } from './types.ts';
import { addInbox } from './morale.ts';
import { revenueFactor } from './finances.ts';
import { randomStaffName } from './names.ts';
import { clamp, rand, weightedChoice } from './random.ts';
import { isPitcher, ovr } from './ratings.ts';
import { addNews, orgPlayers } from './util.ts';
import { cbtTax, fmtMoney, orgPayroll } from './contracts.ts';
import { updateStances } from './market.ts';
import { deptSpend } from './depts.ts';
import { salaryScale, sharedBase } from './economy.ts';

const OWNER_MULT: Record<OwnerType, number> = { Cheap: 0.75, Moderate: 1, 'Big spender': 1.3, 'Win-now': 1.12 };

export function makeOwner(season: number): Owner {
  const { first, last } = randomStaffName();
  const type = weightedChoice<OwnerType>(['Cheap', 'Moderate', 'Big spender', 'Win-now'], [25, 40, 15, 20]);
  return { first, last, type, since: season, patience: 60 };
}

export function baseBudget(org: Org): number {
  return 40e6 + Math.pow(org.market, 1.5) * 170e6;
}

// How far past the base budget an owner will stretch to cover raises the club
// is already committed to (arbitration, escalators).
const FLEX_CAP: Record<OwnerType, number> = { Cheap: 1.04, Moderate: 1.1, 'Big spender': 1.18, 'Win-now': 1.15 };

// Owners budget from market size and spending habits, adjusted for last
// season's success (attendance, playoff revenue). They understand that
// arbitration raises are coming: committed payroll (including projected arb
// salaries) raises the budget up to the owner's flex cap.
export function computeBudget(org: Org, league?: League, committed?: number): number {
  // Revenue sharing narrows the gap between big and small markets a little;
  // inflation lifts everyone.
  const avgBase = league ? league.orgs.reduce((t, o) => t + baseBudget(o), 0) / league.orgs.length : baseBudget(org);
  const scale = league ? salaryScale(league) : 1;
  let b = sharedBase(baseBudget(org), avgBase) * scale * OWNER_MULT[org.owner.type];
  if (org.owner.type === 'Win-now' && org.strategy === 'Contend') b *= 1.08;
  if (org.strategy === 'Rebuild') b *= 0.85;
  // Budgets follow revenue (attendance, merchandise, playoff gates) once
  // there's a season of books; before that, last season's wins.
  const rf = revenueFactor(org);
  const wins = league?.lastWins?.[org.id];
  if (rf !== null) b *= rf;
  else if (wins !== undefined) b *= 1 + clamp((wins - 81) * 0.004, -0.06, 0.08);
  if (committed !== undefined) {
    b = Math.max(b, Math.min(committed * 1.03, b * FLEX_CAP[org.owner.type]));
    // Owners don't cut the budget far below money already on the books.
    b = Math.max(b, committed * 0.92);
  }
  // Even the richest owners balk past ~$375M.
  const top = 375e6 * scale;
  if (b > top) b = top + (b - top) * 0.25;
  return Math.round(b / 1e6) * 1e6;
}

// Revenue-sharing recipients are the smallest markets. Tax payors are clubs
// that were over the CBT threshold in the most recently completed season.
export type RevenueStatus = 'payor' | 'recipient' | 'neutral';

export function lastCompletedSeason(league: League): number {
  return league.phase === 'offseason' ? league.season : league.season - 1;
}

export function revenueStatus(league: League, orgId: number): RevenueStatus {
  const rec = league.cbtHistory.find((r) => r.orgId === orgId && r.season === lastCompletedSeason(league));
  if (rec && rec.cbt > league.settings.cbtThreshold) return 'payor';
  return league.orgs[orgId].market < 0.8 ? 'recipient' : 'neutral';
}

export function cbtOverLastSeason(league: League, orgId: number): number {
  const rec = league.cbtHistory.find((r) => r.orgId === orgId && r.season === lastCompletedSeason(league));
  return rec ? rec.cbt - league.settings.cbtThreshold : -Infinity;
}

// Roster strength from the best 26 players in the organization's 40-man/MLB group.
export function teamStrength(league: League, orgId: number): number {
  const ps = orgPlayers(league, orgId).filter((p) => (p.on40 || p.level === 'MLB') && !p.retired);
  const hit = ps.filter((p) => !isPitcher(p)).map(ovr).sort((a, b) => b - a).slice(0, 13);
  const pit = ps.filter(isPitcher).map(ovr).sort((a, b) => b - a).slice(0, 13);
  return [...hit, ...pit].reduce((t, x) => t + x, 0) / 26;
}

export function updateStrategies(league: League, midseason = false): void {
  const ranks = league.orgs.map((o) => ({ o, s: teamStrength(league, o.id) })).sort((a, b) => b.s - a.s);
  const st = league.standings.MLB;
  ranks.forEach(({ o }, i) => {
    let strat: Strategy = i < 10 ? 'Contend' : i >= 21 ? 'Rebuild' : 'Retool';
    if (midseason) {
      // At the deadline the standings matter most.
      const sameLeague = league.orgs.filter((x) => x.league === o.league).map((x) => st[x.id].w - st[x.id].l).sort((a, b) => b - a);
      const cut = sameLeague[5] ?? 0; // sixth playoff spot
      const gb = (cut - (st[o.id].w - st[o.id].l)) / 2;
      strat = gb <= 3 ? 'Contend' : gb >= 9 ? 'Rebuild' : 'Retool';
    }
    if (o.owner.type === 'Win-now' && strat === 'Rebuild' && !midseason) strat = 'Retool';
    if (o.owner.type === 'Win-now' && strat === 'Retool' && i < 16) strat = 'Contend';
    if (o.owner.type === 'Cheap' && strat === 'Retool' && i >= 17) strat = 'Rebuild';
    o.strategy = strat;
  });
  updateStances(league);
}

export function setBudgets(league: League, committed?: (org: Org) => number): void {
  for (const o of league.orgs) o.budget = computeBudget(o, league, committed?.(o));
}

// At the deadline, owners of contenders loosen the purse strings a little.
export function deadlineFlex(league: League): void {
  for (const o of league.orgs) {
    if (o.strategy !== 'Contend' || o.owner.type === 'Cheap') continue;
    const bump = o.owner.type === 'Moderate' ? 0.04 : 0.07;
    const add = Math.round((o.budget * bump) / 1e6) * 1e6;
    o.budget += add;
    const g = o.goals?.season === league.season ? o.goals.items.find((x) => x.type === 'budget') : undefined;
    if (g && o.owner.type !== 'Big spender') {
      g.target += add;
      g.text = `Keep the CBT payroll under ${fmtMoney(g.target)} (raised for the deadline)`;
    }
    if (o.id === league.userOrgId) addNews(league, o.id, `${o.owner.first} ${o.owner.last} approved an extra ${fmtMoney(add)} of payroll for a deadline push. Your budget is now ${fmtMoney(o.budget)}.`);
  }
}

// Each winter a few clubs are sold; new owners bring new spending habits.
export function ownerSales(league: League): void {
  for (const o of league.orgs) {
    if (rand() > 0.04) continue;
    const prev = o.owner;
    o.owner = makeOwner(league.season);
    addNews(league, o.id, `The ${o.affiliates.MLB.name} were sold. New owner ${o.owner.first} ${o.owner.last} (${o.owner.type.toLowerCase()}) replaces ${prev.first} ${prev.last}.`);
  }
}

// ---------- owner goals ----------

// Wins a roster this strong should produce over 162 games.
export function expectedWins(league: League, orgId: number): number {
  const all = league.orgs.map((o) => teamStrength(league, o.id));
  const mean = all.reduce((t, x) => t + x, 0) / all.length;
  const sd = Math.sqrt(all.reduce((t, x) => t + (x - mean) ** 2, 0) / all.length) || 1;
  return clamp(81 + ((teamStrength(league, orgId) - mean) / sd) * 8, 62, 102);
}

// The owner sets the user's goals for the season at spring training.
export function setOwnerGoals(league: League): void {
  const org = league.orgs[league.userOrgId];
  const season = league.phase === 'offseason' ? league.season + 1 : league.season;
  const exp = expectedWins(league, org.id);
  const t = org.owner.type;
  const items: OwnerGoal[] = [];
  const bump = t === 'Win-now' ? 3 : t === 'Big spender' ? 2 : t === 'Cheap' ? -2 : 0;
  const wins = clamp(Math.round(exp + bump - (org.strategy === 'Rebuild' ? 3 : 0)), 60, 100);
  items.push({ type: 'wins', target: wins, text: `Win ${wins} games` });
  if (exp >= 86 || (t === 'Win-now' && exp >= 82)) items.push({ type: 'playoffs', target: 0, text: 'Make the playoffs' });
  if (exp >= 92 && (t === 'Win-now' || t === 'Big spender')) items.push({ type: 'series', target: 0, text: 'Win a playoff series' });
  const cbt = league.settings.cbtThreshold;
  if (t === 'Big spender' && org.budget > cbt) {
    const cap = cbt + league.settings.cbtTierStep;
    items.push({ type: 'budget', target: cap, text: `Keep the CBT payroll under ${fmtMoney(cap)} (second tax tier)` });
  } else {
    // Already over? The owner gives a little room rather than an impossible target.
    const now = orgPayroll(league, org).cbt;
    const target = Math.max(org.budget, Math.ceil((now + 2e6) / 1e6) * 1e6);
    items.push({ type: 'budget', target, text: `Keep the CBT payroll under ${fmtMoney(target)}${target === org.budget ? ' (budget)' : ''}` });
    if (t !== 'Cheap' && org.budget >= cbt - 15e6) items.push({ type: 'cbt', target: cbt, text: `Stay under the ${fmtMoney(cbt)} luxury tax threshold` });
  }
  org.goals = { season, items, checkins: [] };
  addNews(league, org.id, `${org.owner.first} ${org.owner.last} set your goals for ${season}: ${items.map((g) => g.text[0].toLowerCase() + g.text.slice(1)).join('; ')}.`);
}

function wonSeries(league: League, orgId: number): boolean {
  return !!league.playoffs?.series.some((s) => s.winner === orgId);
}

function goalMet(league: League, org: Org, g: OwnerGoal): boolean {
  const r = league.standings.MLB[org.id];
  const po = league.playoffs;
  switch (g.type) {
    case 'wins': return r.w >= g.target;
    case 'playoffs': return !!po && [...po.seeds.AL, ...po.seeds.NL].includes(org.id);
    case 'series': return wonSeries(league, org.id);
    case 'budget':
    case 'cbt': return orgPayroll(league, org).cbt <= g.target;
  }
}

// Mid-season check-ins: early season and two weeks before the deadline.
export function ownerCheckin(league: League): string | null {
  const org = league.orgs[league.userOrgId];
  const g = org.goals;
  if (!g || g.season !== league.season || league.phase !== 'regular') return null;
  const days = [60, league.settings.tradeDeadlineDay - 14];
  const day = days.find((d) => league.day >= d && !g.checkins.includes(d));
  if (day === undefined) return null;
  g.checkins.push(day);
  const r = league.standings.MLB[org.id];
  const games = r.w + r.l;
  if (games < 20) return null;
  const pace = Math.round((r.w / games) * 162);
  const lines: string[] = [];
  let delta = 0;
  const moneyW = org.owner.type === 'Cheap' ? 1.6 : org.owner.type === 'Big spender' ? 0.5 : 1;
  const resultsW = org.owner.type === 'Win-now' ? 1.5 : 1;
  for (const goal of g.items) {
    if (goal.type === 'wins') {
      const gap = pace - goal.target;
      if (gap >= 3) { lines.push(`You're on pace for ${pace} wins, ahead of the ${goal.target} I asked for.`); delta += 2; }
      else if (gap >= -3) lines.push(`You're on pace for ${pace} wins. I asked for ${goal.target}; keep it there.`);
      else if (gap >= -8) { lines.push(`You're on pace for ${pace} wins. I expected ${goal.target}. I need to see improvement.`); delta -= 3 * resultsW; }
      else { lines.push(`A ${pace}-win pace is nowhere near the ${goal.target} we talked about. This is not acceptable.`); delta -= 6 * resultsW; }
    } else if (goal.type === 'playoffs') {
      const same = league.orgs.filter((o) => o.league === org.league).map((o) => league.standings.MLB[o.id]).map((x) => x.w - x.l).sort((a, b) => b - a);
      const gb = ((same[5] ?? 0) - (r.w - r.l)) / 2;
      if (gb > 0) { lines.push(`We're ${gb.toFixed(1)} games out of a playoff spot. I expect October baseball.`); if (gb >= 5) delta -= 3 * resultsW; }
      else lines.push(`We're in playoff position. Keep it that way.`);
    } else if (goal.type === 'budget' || goal.type === 'cbt') {
      const pay = orgPayroll(league, org).cbt;
      if (pay > goal.target) { lines.push(`Payroll is ${fmtMoney(pay - goal.target)} over the ${goal.type === 'cbt' ? 'tax threshold' : 'limit'} I set.`); delta -= 3 * moneyW; }
    }
  }
  const opsOver = deptSpend(org) - org.opBudget;
  if (opsOver > 0) {
    lines.push(`Department spending is ${fmtMoney(opsOver)} over the operating budget.`);
    delta -= 2 * moneyW;
  }
  org.owner.patience = clamp(Math.round(org.owner.patience + delta), league.settings.allowFiring ? 1 : 5, 100);
  const msg = `Owner check-in from ${org.owner.first} ${org.owner.last}: ${lines.join(' ')} (Job security ${org.owner.patience}/100.)`;
  addNews(league, org.id, msg);
  addInbox(league, { from: `Owner ${org.owner.first} ${org.owner.last}`, subject: delta < 0 ? 'Owner check-in: concerns' : 'Owner check-in', kind: 'info', pids: [], text: msg });
  // Check-ins go to the Inbox; the sim only stops when your job is in real danger.
  return delta < 0 && org.owner.patience <= 20 ? msg : null;
}

// Owner patience with the user, updated at the end of each season.
export function reviewGm(league: League): void {
  const org = league.orgs[league.userOrgId];
  const exp = expectedWins(league, org.id);
  const r = league.standings.MLB[org.id];
  const games = Math.max(1, r.w + r.l);
  const winsPace = (r.w / games) * 162;
  const champ = league.playoffs?.champion === org.id;
  const resultsW = org.owner.type === 'Win-now' ? 1.5 : 1;
  const moneyW = org.owner.type === 'Cheap' ? 1.6 : org.owner.type === 'Big spender' ? 0.5 : 1;
  // Beating or missing what the roster should have done.
  let delta = (winsPace - exp) * 0.8 * resultsW + (champ ? 20 : 0);
  const pay = orgPayroll(league, org);
  const goals = org.goals && org.goals.season === league.season ? org.goals.items : [];
  const results: string[] = [];
  for (const g of goals) {
    const met = goalMet(league, org, g);
    g.met = met;
    results.push(`${g.text}: ${met ? 'met' : 'missed'}`);
    switch (g.type) {
      case 'wins': delta += met ? 6 : -Math.min(20, (g.target - r.w) * 1.2) * resultsW; break;
      case 'playoffs': delta += met ? 10 : -10 * resultsW; break;
      case 'series': delta += met ? 8 : -5 * resultsW; break;
      case 'budget': delta += met ? 4 : -Math.max(0, (pay.cbt - g.target * 1.02) / Math.max(1, g.target)) * 70 * moneyW; break;
      case 'cbt': delta += met ? 3 : -8 * moneyW; break;
    }
  }
  if (!goals.length) {
    const over = pay.cbt - org.budget * 1.02;
    if (over > 0) delta -= (over / org.budget) * 70 * moneyW;
  }
  const tax = cbtTax(pay.cbt, org.cbtPayerYears, league.settings).tax;
  if (tax > 0 && org.owner.type !== 'Big spender') delta -= (tax / 1e6) * 0.4 * moneyW;
  // Draft bonus pool tax.
  const dtax = (league.draftTax ?? []).filter((t) => t.season === league.season && t.orgId === org.id).reduce((t, x) => t + x.tax, 0);
  if (dtax > 0) {
    delta -= (dtax / 1e6) * 0.6 * moneyW;
    results.push(`Paid ${fmtMoney(dtax)} in draft pool tax`);
  }
  // Department spending over the operating budget.
  const opsOver = deptSpend(org) - org.opBudget;
  if (opsOver > 0) {
    delta -= (opsOver / org.opBudget) * 40 * moneyW;
    results.push(`Department spending ${fmtMoney(opsOver)} over the operating budget`);
  }
  const before = org.owner.patience;
  const floor = league.settings.allowFiring ? 0 : 5;
  org.owner.patience = clamp(Math.round(before + delta), floor, 100);
  const mood = org.owner.patience >= 70 ? 'thrilled' : org.owner.patience >= 45 ? 'satisfied' : org.owner.patience >= 20 ? 'concerned' : 'out of patience';
  addNews(league, org.id, `Owner review: ${org.owner.first} ${org.owner.last} is ${mood} (job security ${org.owner.patience}/100, ${delta >= 0 ? '+' : ''}${Math.round(delta)}).${results.length ? ` ${results.join('. ')}.` : ''}`);
  if (org.owner.patience <= 0 && league.settings.allowFiring) {
    league.fired = true;
    addNews(league, org.id, `You have been fired as GM of the ${org.affiliates.MLB.name}.`);
  }
}
