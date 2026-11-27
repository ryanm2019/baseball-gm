// The trade market: what each club needs, what it is shopping, and the
// stance it signals (buying, selling, listening, standing pat).
import type { League, Org, Player, Pos, TradeStance } from './types.ts';
import { FIELD_POS } from './types.ts';
import { ovr } from './ratings.ts';
import { orgPlayers } from './util.ts';
import { rand } from './random.ts';
import { serviceYears } from './contracts.ts';
import { playerTradeBlock } from './trade.ts';

export const NEED_POS: Pos[] = [...FIELD_POS, 'SP', 'RP'];

// MLB-ready players: active roster, injured list and the 40-man.
function mlbGroup(league: League, orgId: number): Player[] {
  return orgPlayers(league, orgId).filter((p) => !p.retired && (p.level === 'MLB' || p.on40 || p.il));
}

// Weakest spots on the big-league club, worst first (at most three).
export function teamNeeds(league: League, orgId: number): Pos[] {
  const ps = mlbGroup(league, orgId);
  const out: { pos: Pos; gap: number }[] = [];
  for (const pos of FIELD_POS) {
    const best = Math.max(35, ...ps.filter((p) => p.pos === pos).map(ovr));
    if (best < 48) out.push({ pos, gap: 48 - best });
  }
  const sp = ps.filter((p) => p.pos === 'SP').map(ovr).sort((a, b) => b - a);
  const fifth = sp[4] ?? 35;
  if (fifth < 46) out.push({ pos: 'SP', gap: (46 - fifth) * 0.9 });
  const rp = ps.filter((p) => p.pos === 'RP').map(ovr).sort((a, b) => b - a).slice(0, 6);
  const rpAvg = rp.length ? rp.reduce((t, x) => t + x, 0) / rp.length : 35;
  if (rpAvg < 47) out.push({ pos: 'RP', gap: (47 - rpAvg) * 0.8 });
  return out.sort((a, b) => b.gap - a.gap).slice(0, 3).map((x) => x.pos);
}

// What a buying club tells other teams it's shopping for (its biggest needs),
// and how much extra it will pay for a player who fills one.
export const NEED_PREMIUM = 1.1;
export function shoppingFor(league: League, org: Org): Pos[] {
  return org.stance === 'Buying' ? teamNeeds(league, org.id) : [];
}

function yearsLeft(league: League, p: Player): number {
  if (p.contract.type !== 'ML') return 0;
  const next = league.phase === 'offseason' ? league.season + 1 : league.season;
  return Math.max(0, p.contract.exp - next + 1);
}

// AI clubs pick a stance from their strategy, with a little personality.
function stanceFor(league: League, org: Org): TradeStance {
  const needs = teamNeeds(league, org.id).length;
  if (org.strategy === 'Contend') return needs > 0 || rand() < 0.5 ? 'Buying' : 'Standing pat';
  if (org.strategy === 'Rebuild') return rand() < 0.9 ? 'Selling' : 'Listening';
  const r = rand();
  return r < 0.2 ? 'Standing pat' : r < 0.4 ? 'Selling' : 'Listening';
}

// A club that just committed to a big free agent (a multi-year deal or $10M+
// a year) doesn't shop him in his first two seasons. Exceptions: a rebuilding
// club that signed him to flip, or one in a full rebuild a year later
// (rebuilding coming out of a later winter, not just a deadline sell-off).
function newSignee(league: League, org: Org, p: Player): boolean {
  if (p.faSigned === undefined || p.teamSince !== p.faSigned || p.faSignedRebuild) return false;
  const c = p.contract;
  if (c.type !== 'ML') return false;
  const season = league.phase === 'offseason' ? league.season + 1 : league.season;
  if (season > p.faSigned && org.strategy === 'Rebuild' && (org.winterStrategy ?? org.strategy) === 'Rebuild') return false;
  const big = c.exp > p.faSigned || c.salary >= 10e6;
  return big && season <= p.faSigned + 1;
}

// Players a club is openly shopping.
function blockFor(league: League, org: Org): number[] {
  if (org.stance === 'Standing pat') return [];
  const ps = orgPlayers(league, org.id).filter((p) => !p.retired && !p.il && !p.prospect && !p.ifa && !p.waivers && !p.dfa && !playerTradeBlock(league, p) && !newSignee(league, org, p));
  const age = (p: Player) => league.season - p.born;
  let picks: Player[] = [];
  if (org.stance === 'Selling') {
    // Veterans with little control left.
    picks = ps.filter((p) => p.level === 'MLB' && age(p) >= 27 && ovr(p) >= 47 && (yearsLeft(league, p) <= 2 || serviceYears(p.mlServiceDays, league.settings) >= 5));
  } else if (org.stance === 'Listening') {
    // Surplus at a position: anyone who isn't the best at his spot.
    for (const pos of FIELD_POS) {
      const same = ps.filter((p) => p.pos === pos && (p.level === 'MLB' || p.level === 'AAA') && ovr(p) >= 46).sort((a, b) => ovr(b) - ovr(a));
      picks.push(...same.slice(1, 2));
    }
    picks.push(...ps.filter((p) => p.level === 'MLB' && age(p) >= 30 && yearsLeft(league, p) === 1 && ovr(p) >= 48));
  } else {
    // Buyers dangle upper-minors players blocked at the big-league level.
    picks = ps.filter((p) => (p.level === 'AAA' || p.level === 'AA') && age(p) >= 23 && ovr(p) >= 44 && p.on40);
  }
  return picks.sort((a, b) => ovr(b) - ovr(a)).slice(0, org.stance === 'Buying' ? 2 : 4).map((p) => p.id);
}

// A club keeps its stance until its strategy changes; it rethinks it once a
// year when free agency opens (fresh).
export function updateStances(league: League, fresh = false): void {
  for (const org of league.orgs) {
    if (org.id !== league.userOrgId && (fresh || org.stanceStrategy !== org.strategy)) {
      org.stance = stanceFor(league, org);
      org.stanceStrategy = org.strategy;
    }
    if (org.id !== league.userOrgId) org.block = blockFor(league, org);
    else org.block = org.block.filter((id) => league.players[id]?.orgId === org.id);
  }
  const user = league.orgs[league.userOrgId];
  user.interest.pids = user.interest.pids.filter((id) => {
    const p = league.players[id];
    return p && !p.retired && p.orgId !== null && p.orgId !== user.id;
  });
}

// Keep blocks current as players move.
export function pruneBlocks(league: League): void {
  for (const org of league.orgs) org.block = org.block.filter((id) => league.players[id]?.orgId === org.id);
}

export const STANCE_HELP: Record<TradeStance, string> = {
  Buying: 'Looking to add big-league help',
  Selling: 'Moving veterans for younger talent',
  Listening: 'Open to the right deal',
  'Standing pat': 'Not looking to make moves',
};

// How many trades happen each day relative to normal: flurries before the
// deadline and through the winter, with the Winter Meetings the busiest.
export function tradeIntensity(league: League, date: Date): number {
  if (league.phase === 'regular') {
    const d = league.settings.tradeDeadlineDay - league.day;
    if (d < 0) return 0;
    if (d === 0) return 5;
    if (d <= 7) return 2.2;
    if (d <= 21) return 0.8;
    return 0.04;
  }
  if (league.phase === 'playoffs') return 0;
  if (league.phase === 'preseason') return 0.15;
  // Offseason: quiet until free agency opens.
  if (!league.events.includes('fa-open')) return 0.05;
  const m = date.getUTCMonth();
  const day = date.getUTCDate();
  if (m === 11) return day >= 7 && day <= 10 ? 3 : 0.65;
  if (m === 10) return 0.45;
  if (m === 0) return 0.45;
  return 0.25;
}
