// Projections, Marcel-style: the last three MLB seasons weighted 5/4/3,
// regressed toward league average, adjusted for age. Players without much MLB
// history are projected from their ratings. Team projections add up projected
// WAR over a typical depth chart.
import type { BatStats, League, Org, PitStats, Player } from './types.ts';
import { isPitcher, ovr } from './ratings.ts';
import { batWar, pitWar, seasonCtx } from './war.ts';
import { activeAt, emptyBat, emptyPit, orgPlayers } from './util.ts';
import { clamp } from './random.ts';

export interface Projection {
  season: number;
  pa: number;
  avg: number; obp: number; slg: number; hr: number;
  ip: number; era: number; k9: number;
  war: number;
  basis: 'stats' | 'ratings';
}

// The season being projected: next season in the winter, this one during it.
export const projSeason = (league: League) => (league.phase === 'offseason' ? league.season + 1 : league.season);

// League rates per PA / per BF for the base season.
const rateCache = new Map<string, { bat: BatStats; pit: PitStats }>();
function leagueTotals(league: League, season: number) {
  const key = `${league.id}:${season}`;
  const hit = rateCache.get(key);
  if (hit && season < league.season) return hit;
  const bat = emptyBat();
  const pit = emptyPit();
  for (const p of Object.values(league.players)) for (const e of p.stats) {
    if (e.season !== season || e.level !== 'MLB') continue;
    for (const k of Object.keys(bat) as (keyof BatStats)[]) bat[k] += e.bat[k];
    for (const k of Object.keys(pit) as (keyof PitStats)[]) pit[k] += e.pit[k];
  }
  const out = { bat, pit };
  rateCache.set(key, out);
  return out;
}

function weighted(p: Player, seasons: number[], f: (e: { bat: BatStats; pit: PitStats }) => number): number {
  const w = [5, 4, 3];
  let t = 0;
  seasons.forEach((s, i) => { for (const e of p.stats) if (e.season === s && e.level === 'MLB') t += w[i] * f(e); });
  return t;
}

export function project(league: League, p: Player): Projection {
  const target = projSeason(league);
  const last = league.phase === 'offseason' || league.phase === 'preseason' ? target - 1 : target;
  const seasons = [last, last - 1, last - 2];
  const base = leagueTotals(league, seasons.find((s) => leagueTotals(league, s).bat.pa > 0) ?? last);
  const ctx = seasonCtx(league, last);
  const age = target - p.born;
  const ageAdj = 1 + clamp((28 - age) * 0.006, -0.06, 0.04);
  const empty: Projection = { season: target, pa: 0, avg: 0, obp: 0, slg: 0, hr: 0, ip: 0, era: 0, k9: 0, war: 0, basis: 'ratings' };
  if (!isPitcher(p)) {
    const pa = weighted(p, seasons, (e) => e.bat.pa);
    if (pa < 5 * 150) {
      // Ratings: about what a player of this overall produces in 550 PA.
      const war = Math.max(-0.5, (ovr(p) - 42) * 0.22) * (ovr(p) >= 50 ? 1 : 0.4);
      return { ...empty, pa: ovr(p) >= 50 ? 550 : 200, war };
    }
    const lgPa = Math.max(1, base.bat.pa);
    const reg = 1200; // regression PA
    const r = (k: keyof BatStats, up = true) => {
      const lg = base.bat[k] / lgPa;
      const own = weighted(p, seasons, (e) => e.bat[k]);
      const v = (own + lg * reg) / (pa + reg);
      return up ? v * ageAdj : v / ageAdj;
    };
    const ppa = Math.round(clamp(0.5 * weighted(p, [last], (e) => e.bat.pa) / 5 + 0.1 * weighted(p, [last - 1], (e) => e.bat.pa) / 4 + 200, 150, 680));
    const b = emptyBat();
    b.pa = ppa;
    b.bb = Math.round(r('bb') * ppa);
    b.hbp = Math.round(r('hbp') * ppa);
    b.sf = Math.round(r('sf') * ppa);
    b.ab = ppa - b.bb - b.hbp - b.sf;
    b.d = Math.round(r('d') * ppa);
    b.t = Math.round(r('t') * ppa);
    b.hr = Math.round(r('hr') * ppa);
    b.h = Math.round(r('h') * ppa);
    b.k = Math.round(r('k', false) * ppa);
    b.sb = Math.round(r('sb') * ppa);
    b.cs = Math.round(r('cs', false) * ppa);
    const avg = b.h / Math.max(1, b.ab);
    const obp = (b.h + b.bb + b.hbp) / Math.max(1, b.ab + b.bb + b.hbp + b.sf);
    const slg = (b.h + b.d + 2 * b.t + 3 * b.hr) / Math.max(1, b.ab);
    return { ...empty, pa: ppa, avg, obp, slg, hr: b.hr, war: batWar(p, b, ctx), basis: 'stats' };
  }
  const bf = weighted(p, seasons, (e) => e.pit.bf);
  const sp = p.pos === 'SP';
  if (bf < 5 * 150) {
    const war = Math.max(-0.3, (ovr(p) - 42) * (sp ? 0.21 : 0.075)) * (ovr(p) >= 50 ? 1 : 0.4);
    return { ...empty, ip: sp ? 150 : 60, war };
  }
  const lgBf = Math.max(1, base.pit.bf);
  const reg = 1000;
  const r = (k: keyof PitStats, good: boolean) => {
    const lg = base.pit[k] / lgBf;
    const own = weighted(p, seasons, (e) => e.pit[k]);
    const v = (own + lg * reg) / (bf + reg);
    return good ? v * ageAdj : v / ageAdj;
  };
  const ipLast = weighted(p, [last], (e) => e.pit.outs) / 5 / 3;
  const ipPrev = weighted(p, [last - 1], (e) => e.pit.outs) / 4 / 3;
  const ip = clamp(0.5 * ipLast + 0.1 * ipPrev + (sp ? 50 : 20), 20, sp ? 205 : 80);
  const pbf = Math.round(ip * 4.25);
  const s = emptyPit();
  s.outs = Math.round(ip * 3);
  s.bf = pbf;
  s.k = Math.round(r('k', true) * pbf);
  s.bb = Math.round(r('bb', false) * pbf);
  s.hbp = Math.round(r('hbp', false) * pbf);
  s.hr = Math.round(r('hr', false) * pbf);
  const fip = ((13 * s.hr + 3 * (s.bb + s.hbp) - 2 * s.k) / ip) + ctx.eraFipC;
  s.er = Math.round((fip * ip) / 9);
  s.r = Math.round(s.er * 1.08);
  s.h = Math.round(r('h', false) * pbf);
  return { ...empty, ip, era: fip, k9: (s.k * 9) / ip, war: pitWar(s, ctx), basis: 'stats' };
}

// ---------- teams ----------

// Projected WAR over a typical depth chart: nine regulars and a bench,
// five starters and eight relievers.
export function teamWar(league: League, org: Org): number {
  const pool = (activeAt(league, org.id, 'MLB').length >= 20 ? activeAt(league, org.id, 'MLB') : orgPlayers(league, org.id).filter((p) => p.on40));
  const hitters = pool.filter((p) => !isPitcher(p)).map((p) => project(league, p)).map((x) => x.war).sort((a, b) => b - a);
  const sps = pool.filter((p) => p.pos === 'SP').map((p) => project(league, p).war).sort((a, b) => b - a);
  const rps = pool.filter((p) => p.pos === 'RP').map((p) => project(league, p).war).sort((a, b) => b - a);
  const sum = (xs: number[], n: number, share = 1) => xs.slice(0, n).reduce((t, x) => t + Math.max(-0.5, x) * share, 0);
  return sum(hitters, 9) + sum(hitters.slice(9), 4, 0.25) + sum(sps, 5) + sum(rps, 8);
}

// Projected wins for every club, centered on .500 (projections are humble).
// Cached until the day, phase or rosters change (the Season Preview and Dashboard call it on every render).
let standingsCache: { key: string; rows: { org: Org; war: number; w: number; l: number }[] } | null = null;
export function projectedStandings(league: League): { org: Org; war: number; w: number; l: number }[] {
  const key = `${league.id}:${league.season}:${league.day}:${league.phase}:${league.nextId.tx}`;
  if (standingsCache?.key === key) return standingsCache.rows;
  const rows = computeStandings(league);
  standingsCache = { key, rows };
  return rows;
}

function computeStandings(league: League): { org: Org; war: number; w: number; l: number }[] {
  const games = league.settings.gamesPerSeason.MLB;
  const rows = league.orgs.map((org) => ({ org, war: teamWar(league, org) }));
  const mean = rows.reduce((t, r) => t + r.war, 0) / rows.length;
  return rows
    .map((r) => {
      const w = Math.round(clamp(games / 2 + (r.war - mean) * 0.85, games * 0.3, games * 0.7));
      return { ...r, w, l: games - w };
    })
    .sort((a, b) => b.w - a.w);
}
