import type { BatStats, League, Level, Org, PitStats, Player, StatEntry } from './types.ts';
import { isPitcher } from './ratings.ts';

export const orgById = (league: League, id: number | null): Org | undefined =>
  id === null ? undefined : league.orgs.find((o) => o.id === id);

export const pname = (p: Player): string => `${p.first} ${p.last}`;

export const age = (league: League, p: Player): number => league.season - p.born;

// Index of players by organization. Rebuilt whenever a player changes
// organization (call touchRosters()) or a different league is loaded.
let idxLeague: League | null = null;
let idx = new Map<number, Player[]>();
let dirty = true;

export function touchRosters(): void {
  dirty = true;
}

function orgIndex(league: League): Map<number, Player[]> {
  if (dirty || idxLeague !== league) {
    idx = new Map();
    for (const p of Object.values(league.players)) {
      if (p.orgId === null) continue;
      const arr = idx.get(p.orgId);
      if (arr) arr.push(p);
      else idx.set(p.orgId, [p]);
    }
    idxLeague = league;
    dirty = false;
  }
  return idx;
}

export function playersAt(league: League, orgId: number, level: Level): Player[] {
  const out: Player[] = [];
  for (const p of orgIndex(league).get(orgId) ?? []) if (p.orgId === orgId && p.level === level) out.push(p);
  return out;
}

export function orgPlayers(league: League, orgId: number): Player[] {
  return (orgIndex(league).get(orgId) ?? []).filter((p) => p.orgId === orgId);
}

// Players counting against an affiliate's active roster: assigned there and not on an IL.
export const activeAt = (league: League, orgId: number, level: Level): Player[] =>
  playersAt(league, orgId, level).filter((p) => !p.il && !p.dfa && !p.waivers);

export const fortyMan = (league: League, orgId: number): Player[] =>
  orgPlayers(league, orgId).filter((p) => p.on40 && !(p.il && p.il.type === 'IL60'));

export const isSeptember = (league: League): boolean => league.day >= league.settings.septemberDay;

export const activeLimit = (league: League): number =>
  isSeptember(league) ? league.settings.activeMaxSept : league.settings.activeMax;

export const pitcherLimit = (league: League): number =>
  isSeptember(league) ? league.settings.pitcherMaxSept : league.settings.pitcherMax;

export const countPitchers = (ps: Player[]): number => ps.filter(isPitcher).length;

export function addTransaction(league: League, orgId: number | null, type: string, text: string, pids: number[]): void {
  league.transactions.push({ id: league.nextId.tx++, season: league.season, day: league.day, orgId, type, text, pids });
}

export function addNews(league: League, orgId: number | null, text: string, pids: number[] = []): void {
  league.news.push({ id: league.nextId.news++, season: league.season, day: league.day, orgId, text, pids });
  if (league.news.length > 600) league.news.splice(0, league.news.length - 600);
}

export const emptyBat = (): BatStats => ({
  g: 0, gs: 0, pa: 0, ab: 0, h: 0, d: 0, t: 0, hr: 0, r: 0, rbi: 0, bb: 0, k: 0, hbp: 0, sb: 0, cs: 0, sf: 0, gidp: 0, e: 0,
});

export const emptyPit = (): PitStats => ({
  g: 0, gs: 0, w: 0, l: 0, sv: 0, hld: 0, bs: 0, outs: 0, h: 0, r: 0, er: 0, bb: 0, k: 0, hr: 0, hbp: 0, bf: 0, pitches: 0,
});

export function statEntry(p: Player, season: number, level: Level, orgId: number): StatEntry {
  for (let i = p.stats.length - 1; i >= 0; i--) {
    const s = p.stats[i];
    if (s.season === season && s.level === level && s.orgId === orgId) return s;
    if (s.season < season) break;
  }
  const s: StatEntry = { season, level, orgId, bat: emptyBat(), pit: emptyPit() };
  p.stats.push(s);
  return s;
}

export function sumBat(entries: StatEntry[]): BatStats {
  const t = emptyBat();
  for (const e of entries) for (const k of Object.keys(t) as (keyof BatStats)[]) t[k] += e.bat[k];
  return t;
}

export function sumPit(entries: StatEntry[]): PitStats {
  const t = emptyPit();
  for (const e of entries) for (const k of Object.keys(t) as (keyof PitStats)[]) t[k] += e.pit[k];
  return t;
}

export const avg = (b: BatStats) => (b.ab ? b.h / b.ab : 0);
export const obp = (b: BatStats) => {
  const den = b.ab + b.bb + b.hbp + b.sf;
  return den ? (b.h + b.bb + b.hbp) / den : 0;
};
export const slg = (b: BatStats) => (b.ab ? (b.h + b.d + 2 * b.t + 3 * b.hr) / b.ab : 0);
export const ops = (b: BatStats) => obp(b) + slg(b);
export const era = (p: PitStats) => (p.outs ? (p.er * 27) / p.outs : 0);
export const whip = (p: PitStats) => (p.outs ? ((p.h + p.bb) * 3) / p.outs : 0);
export const ipStr = (outs: number) => `${Math.floor(outs / 3)}.${outs % 3}`;
export const fip = (p: PitStats) => (p.outs ? ((13 * p.hr + 3 * (p.bb + p.hbp) - 2 * p.k) * 3) / p.outs + 3.1 : 0);

export const fmt3 = (x: number) => (x >= 1 ? x.toFixed(3) : x.toFixed(3).replace(/^0/, ''));
