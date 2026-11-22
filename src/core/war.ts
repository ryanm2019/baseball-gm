// Wins above replacement from MLB stats, FanGraphs-style:
//  hitters: batting runs (wOBA) + baserunning + fielding (from ratings) +
//           positional adjustment + replacement runs
//  pitchers: FIP-based runs saved against a replacement-level RA9
// League constants are derived from each season's own MLB totals.
import type { BatStats, FieldPos, League, Level, PitStats, Player, StatEntry } from './types.ts';
import { defAt, isPitcher } from './ratings.ts';
import { emptyBat, emptyPit, sumBat, sumPit } from './util.ts';
import { MINOR_LEVELS } from './types.ts';
import { clamp } from './random.ts';

export interface Ctx {
  woba: number;
  wobaScale: number;
  ra9: number;
  fipC: number;
  rpw: number;
  // For advanced rate stats (league averages at this level and season).
  obp: number;
  slg: number;
  rPerPa: number;
  era: number;
  eraFipC: number; // FIP constant that puts league FIP on the ERA scale
  babip: number;
}

const W = { bb: 0.69, hbp: 0.72, b1: 0.89, b2: 1.27, b3: 1.62, hr: 2.1 };
const POS_RUNS: Record<string, number> = { C: 12.5, SS: 7.5, CF: 2.5, '2B': 2.5, '3B': 2.5, LF: -7.5, RF: -7.5, '1B': -12.5, DH: -17.5 };
const REPL_PER_PA = 0.031; // ~570 hitter WAR per season across the league
const REPL_SP = 1.1; // runs per 9 innings worse than average
const REPL_RP = 0.55;

export function wobaNum(b: BatStats): number {
  const ubb = b.bb;
  const b1 = b.h - b.d - b.t - b.hr;
  return W.bb * ubb + W.hbp * b.hbp + W.b1 * b1 + W.b2 * b.d + W.b3 * b.t + W.hr * b.hr;
}
export const wobaDen = (b: BatStats) => b.ab + b.bb + b.hbp + b.sf;

const cache = new Map<string, Ctx>();

function levelEntries(league: League, season: number, level: Level): StatEntry[] {
  const out: StatEntry[] = [];
  for (const p of Object.values(league.players)) {
    for (let i = p.stats.length - 1; i >= 0; i--) {
      const s = p.stats[i];
      if (s.season < season) break;
      if (s.season === season && s.level === level) out.push(s);
    }
  }
  return out;
}

export function seasonCtx(league: League, season: number, level: Level = 'MLB'): Ctx {
  const live = season === league.season && league.phase !== 'offseason';
  const key = `${league.id}:${season}:${level}${live ? `:${league.day}:${league.phase}` : ''}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const bat = emptyBat();
  const pit = emptyPit();
  for (const e of levelEntries(league, season, level)) {
    for (const k of Object.keys(bat) as (keyof BatStats)[]) bat[k] += e.bat[k];
    for (const k of Object.keys(pit) as (keyof PitStats)[]) pit[k] += e.pit[k];
  }
  const den = wobaDen(bat);
  const woba = den ? wobaNum(bat) / den : 0.315;
  const ra9 = pit.outs ? (pit.r * 27) / pit.outs : 4.4;
  const rawFip = pit.outs ? ((13 * pit.hr + 3 * (pit.bb + pit.hbp) - 2 * pit.k) * 3) / pit.outs : 0;
  const rpg = ra9; // runs per team-game
  const era = pit.outs ? (pit.er * 27) / pit.outs : 4.1;
  const obpDen = bat.ab + bat.bb + bat.hbp + bat.sf;
  const bip = bat.ab - bat.k - bat.hr + bat.sf;
  const ctx: Ctx = {
    woba,
    wobaScale: 1.21,
    ra9,
    fipC: ra9 - rawFip,
    rpw: 2 * rpg + 1.2,
    obp: obpDen ? (bat.h + bat.bb + bat.hbp) / obpDen : 0.315,
    slg: bat.ab ? (bat.h + bat.d + 2 * bat.t + 3 * bat.hr) / bat.ab : 0.4,
    rPerPa: bat.pa ? bat.r / bat.pa : 0.115,
    era,
    eraFipC: era - rawFip,
    babip: bip > 0 ? (bat.h - bat.hr) / bip : 0.29,
  };
  if (live) for (const k of cache.keys()) if (k.startsWith(`${league.id}:${season}:${level}:`)) cache.delete(k);
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
  const fielding = pos === 'DH' ? 0 : (defAt(p, pos as FieldPos) - 50) * 0.3 * share;
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

// ---------- advanced rate stats ----------
// wRC+, OPS+, ERA+ and FIP- are relative to the league at that level and
// season (100 = average; no park factors).

export interface BatAdv { woba: number; wrcPlus: number; opsPlus: number; iso: number; babip: number; bbPct: number; kPct: number }
export interface PitAdv { fip: number; eraPlus: number; fipMinus: number; kPct: number; bbPct: number; kbb: number; babip: number; hr9: number }

export function batAdvanced(b: BatStats, ctx: Ctx): BatAdv {
  const den = wobaDen(b);
  const woba = den ? wobaNum(b) / den : 0;
  const obp = den ? (b.h + b.bb + b.hbp) / den : 0;
  const slg = b.ab ? (b.h + b.d + 2 * b.t + 3 * b.hr) / b.ab : 0;
  const bip = b.ab - b.k - b.hr + b.sf;
  const wraaPa = (woba - ctx.woba) / ctx.wobaScale;
  return {
    woba,
    wrcPlus: b.pa ? Math.round(((wraaPa + ctx.rPerPa) / ctx.rPerPa) * 100) : 0,
    opsPlus: b.pa ? Math.round(100 * (obp / ctx.obp + slg / ctx.slg - 1)) : 0,
    iso: b.ab ? slg - b.h / b.ab : 0,
    babip: bip > 0 ? (b.h - b.hr) / bip : 0,
    bbPct: b.pa ? b.bb / b.pa : 0,
    kPct: b.pa ? b.k / b.pa : 0,
  };
}

export function pitAdvanced(s: PitStats, ctx: Ctx): PitAdv {
  const ip = s.outs / 3;
  const fip = ip ? (13 * s.hr + 3 * (s.bb + s.hbp) - 2 * s.k) / ip + ctx.eraFipC : 0;
  const era = s.outs ? (s.er * 27) / s.outs : 0;
  const bip = s.bf - s.k - s.bb - s.hbp - s.hr;
  return {
    fip,
    eraPlus: s.outs ? Math.round((100 * ctx.era) / Math.max(0.5, era)) : 0,
    fipMinus: s.outs ? Math.round((100 * fip) / ctx.era) : 0,
    kPct: s.bf ? s.k / s.bf : 0,
    bbPct: s.bf ? s.bb / s.bf : 0,
    kbb: s.bf ? (s.k - s.bb) / s.bf : 0,
    babip: bip > 0 ? (s.h - s.hr) / bip : 0,
    hr9: ip ? (s.hr * 9) / ip : 0,
  };
}

// What his recent MLB performance says his overall is, and how much weight a
// front office would put on it (sample size). Used for arbitration, free
// agent asking prices and how other clubs value him in trades.
export function perfOvr(league: League, p: Player): { est: number; w: number } | null {
  // Offseason: the season just finished counts most, then the one before.
  // In season: this season, then the last two.
  const pairs: [number, number][] = league.phase === 'offseason'
    ? [[league.season, 1], [league.season - 1, 0.6]]
    : [[league.season, 1], [league.season - 1, 0.7], [league.season - 2, 0.4]];
  let war = 0;
  let sample = 0;
  const pit = isPitcher(p);
  pairs.forEach(([season, wt]) => {
    for (const e of p.stats) {
      if (e.season !== season || e.level !== 'MLB') continue;
      const n = pit ? e.pit.outs : e.bat.pa;
      if (!n) continue;
      const ctx = seasonCtx(league, season);
      war += wt * (pit ? pitWar(e.pit, ctx) : batWar(p, e.bat, ctx));
      sample += wt * n;
    }
  });
  if (sample <= 0) return null;
  const full = pit ? (p.pos === 'SP' ? 540 : 195) : 600;
  const rate = (war / sample) * full; // WAR per full season
  // What the sim actually produces per full season at a given overall (fit on
  // simulated seasons): rate = a + b * ovr. Reading it backward gives an
  // unbiased overall from the numbers.
  const [a, b] = !pit ? [-9.94, 0.22] : p.pos === 'SP' ? [-5.22, 0.132] : [-1.62, 0.042];
  const est = Math.max(25, Math.min(85, (rate - a) / b));
  // Two strong full seasons count for about two-thirds; the cap keeps ratings in the picture.
  const k = pit ? (p.pos === 'SP' ? 800 : 350) : 800;
  return { est, w: Math.min(0.75, sample / (sample + k)) };
}

// Overall as the market sees it: ratings blended with recent performance.
export function marketOvr(league: League, p: Player, o: number, maxW = 1): number {
  const perf = perfOvr(league, p);
  if (!perf) return o;
  return o + Math.min(maxW, perf.w) * (perf.est - o);
}

// Production at one level on a "plus" scale (100 = that level's average, higher
// is better): wRC+ for hitters, 200 - FIP- for pitchers. n = PA or batters faced.
export function levelPlus(league: League, p: Player, season: number, level: Level): { plus: number; n: number } | null {
  const es = p.stats.filter((s) => s.season === season && s.level === level);
  if (!es.length) return null;
  const ctx = seasonCtx(league, season, level);
  if (isPitcher(p)) {
    const s = sumPit(es);
    return s.outs ? { plus: 200 - pitAdvanced(s, ctx).fipMinus, n: s.bf } : null;
  }
  const b = sumBat(es);
  return b.pa ? { plus: batAdvanced(b, ctx).wrcPlus, n: b.pa } : null;
}

// Typical age at each minor-league level; younger and producing is the best sign.
const LEVEL_AGE: Record<string, number> = { AAA: 26.5, AA: 24, 'A+': 22.5, A: 21.5, CPX: 20, DSL: 18 };

// What front offices read from a minor leaguer's numbers (this season and last,
// weighted by sample), in rating points: roughly -4 to +5.
export function minorPerfAdj(league: League, p: Player): number {
  if (!p.level || p.level === 'MLB') return 0;
  const cur = league.phase === 'preseason' ? league.season - 1 : league.season;
  let num = 0;
  let den = 0;
  for (const [season, w] of [[cur, 1], [cur - 1, 0.5]] as const) {
    for (const level of MINOR_LEVELS) {
      const r = levelPlus(league, p, season, level);
      if (!r) continue;
      const young = clamp(LEVEL_AGE[level] - (season - p.born), -2, 3);
      const score = (r.plus - 100) / 12 + young * (r.plus >= 95 ? 0.5 : 0.15);
      num += score * r.n * w;
      den += r.n * w;
    }
  }
  if (!den) return 0;
  return clamp((num / den) * (den / (den + 400)), -4, 5);
}
