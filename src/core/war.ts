// Wins above replacement from MLB stats, FanGraphs-style:
//  hitters: batting runs (wOBA) + baserunning + fielding (from ratings) +
//           positional adjustment + replacement runs
//  pitchers: FIP-based runs saved against a replacement-level RA9
// League constants are derived from each season's own MLB totals.
import type { BatStats, FieldPos, League, PitStats, Player, StatEntry } from './types.ts';
import { isPitcher, posRating } from './ratings.ts';
import { emptyBat, emptyPit } from './util.ts';

interface Ctx {
  woba: number;
  wobaScale: number;
  ra9: number;
  fipC: number;
  rpw: number;
}

const W = { bb: 0.69, hbp: 0.72, b1: 0.89, b2: 1.27, b3: 1.62, hr: 2.1 };
const POS_RUNS: Record<string, number> = { C: 12.5, SS: 7.5, CF: 2.5, '2B': 2.5, '3B': 2.5, LF: -7.5, RF: -7.5, '1B': -12.5, DH: -17.5 };
const REPL_PER_PA = 0.031; // ~570 hitter WAR per season across the league
const REPL_SP = 1.1; // runs per 9 innings worse than average
const REPL_RP = 0.55;

function wobaNum(b: BatStats): number {
  const ubb = b.bb;
  const b1 = b.h - b.d - b.t - b.hr;
  return W.bb * ubb + W.hbp * b.hbp + W.b1 * b1 + W.b2 * b.d + W.b3 * b.t + W.hr * b.hr;
}
const wobaDen = (b: BatStats) => b.ab + b.bb + b.hbp + b.sf;

const cache = new Map<string, Ctx>();

function mlbEntries(league: League, season: number): StatEntry[] {
  const out: StatEntry[] = [];
  for (const p of Object.values(league.players)) {
    for (let i = p.stats.length - 1; i >= 0; i--) {
      const s = p.stats[i];
      if (s.season < season) break;
      if (s.season === season && s.level === 'MLB') out.push(s);
    }
  }
  return out;
}

export function seasonCtx(league: League, season: number): Ctx {
  const live = season === league.season && league.phase !== 'offseason';
  const key = `${league.id}:${season}${live ? `:${league.day}:${league.phase}` : ''}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const bat = emptyBat();
  const pit = emptyPit();
  for (const e of mlbEntries(league, season)) {
    for (const k of Object.keys(bat) as (keyof BatStats)[]) bat[k] += e.bat[k];
    for (const k of Object.keys(pit) as (keyof PitStats)[]) pit[k] += e.pit[k];
  }
  const den = wobaDen(bat);
  const woba = den ? wobaNum(bat) / den : 0.315;
  const ra9 = pit.outs ? (pit.r * 27) / pit.outs : 4.4;
  const rawFip = pit.outs ? ((13 * pit.hr + 3 * (pit.bb + pit.hbp) - 2 * pit.k) * 3) / pit.outs : 0;
  const rpg = ra9; // runs per team-game
  const ctx: Ctx = {
    woba,
    wobaScale: 1.21,
    ra9,
    fipC: ra9 - rawFip,
    rpw: 2 * rpg + 1.2,
  };
  if (live) for (const k of cache.keys()) if (k.startsWith(`${league.id}:${season}:`)) cache.delete(k);
  cache.set(key, ctx);
  return ctx;
}

export function batWar(p: Player, b: BatStats, ctx: Ctx): number {
  if (!b.pa) return 0;
  const den = wobaDen(b);
  const woba = den ? wobaNum(b) / den : 0;
  const batting = ((woba - ctx.woba) / ctx.wobaScale) * b.pa;
  const running = 0.2 * b.sb - 0.41 * b.cs - 0.3 * Math.max(0, b.gidp - b.pa * 0.018);
  const pos = isPitcher(p) ? 'DH' : p.pos;
  const share = b.pa / 650;
  const fielding = pos === 'DH' ? 0 : (posRating(p.ratings.def, pos as FieldPos) - 50) * 0.3 * share;
  const positional = (POS_RUNS[pos] ?? 0) * share;
  const repl = REPL_PER_PA * b.pa;
  return (batting + running + fielding + positional + repl) / ctx.rpw;
}

export function pitWar(s: PitStats, ctx: Ctx): number {
  if (!s.outs) return 0;
  const ip = s.outs / 3;
  const fip = ((13 * s.hr + 3 * (s.bb + s.hbp) - 2 * s.k) / ip) + ctx.fipC;
  const spShare = s.g ? s.gs / s.g : 0;
  const repl = REPL_SP * spShare + REPL_RP * (1 - spShare);
  return ((ctx.ra9 + repl - fip) * ip) / 9 / ctx.rpw;
}

export function entryWar(league: League, p: Player, e: StatEntry): number {
  if (e.level !== 'MLB') return 0;
  const ctx = seasonCtx(league, e.season);
  return batWar(p, e.bat, ctx) + pitWar(e.pit, ctx);
}

// MLB WAR, optionally only with one organization and from a season onward.
export function playerWar(league: League, p: Player, opts: { orgId?: number; from?: number; season?: number } = {}): number {
  let t = 0;
  for (const e of p.stats) {
    if (e.level !== 'MLB') continue;
    if (opts.orgId !== undefined && e.orgId !== opts.orgId) continue;
    if (opts.from !== undefined && e.season < opts.from) continue;
    if (opts.season !== undefined && e.season !== opts.season) continue;
    t += entryWar(league, p, e);
  }
  return t;
}

// Salary paid by one organization from a season onward.
export function salaryPaid(p: Player, orgId: number, from: number): number {
  let t = 0;
  for (const [k, v] of Object.entries(p.earned ?? {})) {
    const [season, org] = k.split(':').map(Number);
    if (org === orgId && season >= from) t += v;
  }
  return t;
}
