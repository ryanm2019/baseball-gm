// Club finances: attendance, revenue and fan hype.
//
// Every MLB home game draws a crowd: stadium size scales with market, demand
// with hype (built by winning, the playoffs and stars), how the team is doing
// right now, and the ticket price (which you can set). Revenue = gate +
// merchandise (stars sell jerseys) + local media (market) + national money +
// home playoff games. Owner budgets follow revenue: a club that out-earns what
// its market normally brings in gets more to spend next year, and vice versa.
import type { League, Org } from './types.ts';
import { activeAt } from './util.ts';
import { ovr } from './ratings.ts';
import { clamp } from './random.ts';

export interface Fin {
  hype: number; // 0-100
  ticket: number; // average ticket price, dollars
  season: number;
  games: number;
  attendance: number;
  gate: number;
  merch: number;
  playoffs: number;
  last?: { season: number; revenue: number; expected: number; avgAtt: number; hype: number };
  history?: { season: number; revenue: number; avgAtt: number; wins: number }[];
}

export const baseTicket = (org: Org) => Math.round(32 + 22 * org.market);
export const capacity = (org: Org) => Math.round(clamp(30000 + 12000 * org.market, 34000, 50000));
const NATIONAL = 70e6; // national TV and shared revenue, per club
export const localMedia = (org: Org) => 25e6 + 70e6 * Math.pow(org.market, 1.4);

export function finOf(league: League, org: Org): Fin {
  const f = (org as Org & { fin?: Fin }).fin;
  if (f && f.season === league.season) return f;
  const prev = f;
  const next: Fin = { hype: prev?.hype ?? 50, ticket: prev?.ticket ?? baseTicket(org), season: league.season, games: 0, attendance: 0, gate: 0, merch: 0, playoffs: 0, last: prev?.last, history: prev?.history };
  (org as Org & { fin?: Fin }).fin = next;
  return next;
}

// Star power: players fans pay to see.
function stars(league: League, org: Org): number {
  return activeAt(league, org.id, 'MLB').filter((p) => ovr(p) >= 62).length;
}

function winPct(league: League, org: Org): number {
  const st = league.standings.MLB?.[org.id];
  return st && st.w + st.l >= 10 ? st.w / (st.w + st.l) : 0.5;
}

// Expected crowd at a given ticket price.
export function crowd(league: League, org: Org, ticket: number, playoff = false): number {
  const f = finOf(league, org);
  const base = baseTicket(org);
  const demand = 0.42 + 0.005 * f.hype + (winPct(league, org) - 0.5) * 0.9 + 0.02 * Math.min(5, stars(league, org)) - ((ticket - base) / base) * 0.55;
  return Math.round(capacity(org) * clamp(playoff ? 1 : demand, 0.2, 1));
}

export function homeGate(league: League, homeId: number, playoff: boolean): void {
  const org = league.orgs[homeId];
  const f = finOf(league, org);
  const att = crowd(league, org, f.ticket, playoff);
  const price = playoff ? f.ticket * 1.8 : f.ticket;
  const merch = att * (6 + 1.2 * Math.min(5, stars(league, org)));
  if (playoff) f.playoffs += att * price + merch;
  else {
    f.games++;
    f.attendance += att;
    f.gate += att * price;
    f.merch += merch;
  }
}

export function revenueSoFar(league: League, org: Org): { gate: number; merch: number; media: number; national: number; playoffs: number; total: number } {
  const f = finOf(league, org);
  const share = Math.min(1, f.games / (league.settings.gamesPerSeason.MLB / 2));
  const media = localMedia(org) * share;
  const national = NATIONAL * share;
  return { gate: f.gate, merch: f.merch, media, national, playoffs: f.playoffs, total: f.gate + f.merch + media + national + f.playoffs };
}

// What a club in this market makes in a .500 season with average hype at the default price.
export function expectedRevenue(org: Org, league: League): number {
  const games = league.settings.gamesPerSeason.MLB / 2;
  const att = capacity(org) * clamp(0.42 + 0.25, 0.2, 1);
  return games * att * (baseTicket(org) + 6 + 1.2) + localMedia(org) + NATIONAL;
}

// Weekly: hype drifts toward what the club is giving fans.
export function hypeWeek(league: League): void {
  if (league.phase !== 'regular') return;
  for (const org of league.orgs) {
    const f = finOf(league, org);
    const target = clamp(50 + (winPct(league, org) - 0.5) * 220 + 3 * Math.min(5, stars(league, org)) - ((f.ticket - baseTicket(org)) / baseTicket(org)) * 20, 5, 100);
    f.hype = clamp(f.hype + (target - f.hype) * 0.06, 0, 100);
  }
}

// Season end: close the books, a playoff bump for hype.
export function closeBooks(league: League): void {
  for (const org of league.orgs) {
    const f = finOf(league, org);
    const rev = revenueSoFar(league, org).total;
    const st = league.standings.MLB?.[org.id];
    const po = league.playoffs;
    if (po && (po.seeds.AL.includes(org.id) || po.seeds.NL.includes(org.id))) f.hype = clamp(f.hype + (po.champion === org.id ? 15 : 7), 0, 100);
    f.last = { season: league.season, revenue: rev, expected: expectedRevenue(org, league), avgAtt: f.games ? f.attendance / f.games : 0, hype: f.hype };
    f.history = [...(f.history ?? []), { season: league.season, revenue: rev, avgAtt: f.last.avgAtt, wins: st?.w ?? 0 }].slice(-20);
  }
}

// Budget multiplier from last season's revenue vs. what the market normally brings in.
export function revenueFactor(org: Org): number | null {
  const last = (org as Org & { fin?: Fin }).fin?.last;
  if (!last || !last.expected) return null;
  return clamp(Math.pow(last.revenue / last.expected, 0.6), 0.88, 1.12);
}
