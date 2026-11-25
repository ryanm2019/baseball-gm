// Builds a game-day lineup, starting pitcher and bullpen for one team at one level.
import type { DepthChart, FieldPos, League, Level, PenRole, Player, Pos } from '../types.ts';
import { streak } from '../positions.ts';
import { blendSplits, defAt, isPitcher, offense, ovr } from '../ratings.ts';
import { activeAt, orgPlayers } from '../util.ts';
import { potOvr } from '../ratings.ts';
import { playoffRosterFor } from '../playoffRoster.ts';
import { rand } from '../random.ts';
import { delegated, managerMods, pitcherInjuryMult, type ManagerMods } from '../staff.ts';
import { deptEffect } from '../depts.ts';

export interface GameLineup {
  orgId: number;
  opener?: boolean; // bullpen day: the starter is an opener
  level: Level;
  batters: { p: Player; pos: Pos }[];
  sp: Player;
  bullpen: Player[];
  closer: Player | null;
  setup: Player[];
  roles: Map<number, PenRole>; // every bullpen arm's role
  medical: number; // injury multiplier from the medical department
  bench: Player[];
  mgr: ManagerMods;
  pInjury: number;
}

const FILL_ORDER: FieldPos[] = ['C', 'SS', 'CF', '2B', '3B', 'RF', 'LF', '1B'];

export const offVs = (p: Player, hand: 'L' | 'R'): number => offense(hand === 'L' ? p.ratings.vL : p.ratings.vR);

// The organization's top 30 prospects (cached for the day): the farm director
// makes sure they play every day and keep their rotation turns.
const prospectCache = new Map<string, Map<number, number>>();
export function topProspects(league: League, orgId: number): Map<number, number> {
  const key = `${league.id}:${league.season}:${league.day}:${orgId}`;
  const hit = prospectCache.get(key);
  if (hit) return hit;
  if (prospectCache.size > 200) prospectCache.clear();
  const ranked = orgPlayers(league, orgId)
    .filter((p) => p.mlServiceDays < 45 && p.level && p.level !== 'MLB')
    .map((p) => ({ p, v: potOvr(p) * 0.75 + ovr(p) * 0.25 - (league.season - p.born) * 0.15 }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 30);
  const m = new Map(ranked.map((x, i) => [x.p.id, i + 1]));
  prospectCache.set(key, m);
  return m;
}

// Where an overlapping prospect slides over to learn a second spot.
const NEARBY: Record<string, FieldPos[]> = { SS: ['2B', '3B'], '2B': ['SS', '3B'], '3B': ['1B', 'SS', '2B'], '1B': ['3B', 'LF', 'RF'], CF: ['LF', 'RF'], LF: ['RF', '1B'], RF: ['LF', '1B'], C: ['1B'] };

export function restDays(league: League, p: Player): number {
  return league.day - p.lastStartDay;
}

const manualDepth = (league: League, orgId: number, level: Level, depth: DepthChart | undefined): depth is DepthChart =>
  !!depth && !depth.auto && !(orgId === league.userOrgId && level === 'MLB' && delegated(league, league.orgs[orgId], 'depth'));

// The rotation in order (in the playoffs, only the playoff starters).
export function rotationOf(league: League, orgId: number, level: Level, pitchers: Player[], depth: DepthChart | undefined): Player[] {
  let rotation: Player[] = [];
  if (manualDepth(league, orgId, level, depth) && depth.rotation.length) {
    rotation = depth.rotation.map((id) => league.players[id]).filter((p) => p && pitchers.includes(p));
  }
  if (rotation.length < 5) {
    const top = level !== 'MLB' ? topProspects(league, orgId) : new Map<number, number>();
    const sps = pitchers
      .filter((p) => !rotation.includes(p))
      .sort((a, b) => (b.pos === 'SP' ? 1 : 0) - (a.pos === 'SP' ? 1 : 0) || (top.has(b.id) && b.pos === 'SP' ? 1 : 0) - (top.has(a.id) && a.pos === 'SP' ? 1 : 0) || b.ratings.pit.stamina - a.ratings.pit.stamina + (ovr(b) - ovr(a)) * 0.5);
    const auto = sps.filter((p) => p.pos === 'SP' || p.ratings.pit.stamina >= 45);
    rotation = rotation.concat(auto.slice(0, 5 - rotation.length));
  }
  if (rotation.length === 0) rotation = [...pitchers].sort((a, b) => b.ratings.pit.stamina - a.ratings.pit.stamina).slice(0, 5);
  if (league.phase === 'playoffs' && level === 'MLB') rotation = rotation.slice(0, depth?.playoffRotation ?? 4);
  return rotation;
}

// Bullpen day: a rested reliever opens (not the closer), the bullpen covers the rest.
function opener(league: League, pitchers: Player[]): Player | null {
  const rps = pitchers.filter((p) => p.pos === 'RP' && league.day - p.lastPitchedDay >= 2).sort((a, b) => ovr(b) - ovr(a));
  return rps[Math.min(1, rps.length - 1)] ?? null;
}

export function pickStarter(league: League, orgId: number, level: Level, pitchers: Player[], depth: DepthChart | undefined, out?: { bullpenDay?: boolean }): Player | null {
  const org = league.orgs[orgId];
  const playoffs = league.phase === 'playoffs' && level === 'MLB';
  const rotation = rotationOf(league, orgId, level, pitchers, depth);
  if (rotation.length === 0) return null;
  // Rotation slots marked as bullpen games (yours, from the Depth Chart).
  const bpd = new Set(!playoffs && manualDepth(league, orgId, level, depth) ? depth.bullpenDays ?? [] : []);
  const cycle = Math.max(rotation.length, ...[...bpd].map((x) => x + 1));
  const idx0 = (org.rotationIndex[level] ?? 0) % cycle;
  for (let k = 0; k < cycle; k++) {
    const slot = (idx0 + k) % cycle;
    if (bpd.has(slot)) {
      const op = opener(league, pitchers);
      if (!op) continue;
      org.rotationIndex[level] = (slot + 1) % cycle;
      if (out) out.bullpenDay = true;
      return op;
    }
    const p = rotation[slot];
    if (!p) continue;
    // Playoff off days let a short rotation go on four days' rest.
    if (restDays(league, p) >= (playoffs ? 4 : 5) && league.day - p.lastPitchedDay >= 2) {
      org.rotationIndex[level] = (slot + 1) % cycle;
      return p;
    }
  }
  // Nobody rested: a big-league club goes with a bullpen game; the minors spot start.
  if (level === 'MLB' && !playoffs) {
    const op = opener(league, pitchers);
    if (op) { if (out) out.bullpenDay = true; return op; }
  }
  const all = [...pitchers].sort((a, b) => restDays(league, b) - restDays(league, a) || b.ratings.pit.stamina - a.ratings.pit.stamina);
  return all[0] ?? null;
}


// How much the glove counts at each spot when the manager fills the lineup:
// a lot up the middle, little at first base or DH. A real liability at a
// premium spot costs extra.
const DEF_WEIGHT: Partial<Record<Pos, number>> = { C: 1.0, SS: 1.0, CF: 0.9, '2B': 0.8, '3B': 0.7, RF: 0.55, LF: 0.5, '1B': 0.35 };
function defValue(p: Player, pos: Pos): number {
  if (pos === 'DH' || pos === 'SP' || pos === 'RP') return 0;
  const d = defAt(p, pos);
  const w = DEF_WEIGHT[pos] ?? 0.6;
  return w * (d - 50) - (w >= 0.8 && d < 40 ? (40 - d) * 0.6 : 0);
}

// Down on the farm, development comes first: young players with real
// potential get the at-bats over organizational filler (most at the complex
// and DSL, less in A-ball, none above that).
const DEV_WEIGHT: Partial<Record<Level, number>> = { DSL: 1, CPX: 1, A: 0.7, 'A+': 0.5 };
function devBonus(league: League, p: Player, level: Level): number {
  const w = DEV_WEIGHT[level];
  if (!w) return 0;
  const age = league.season - p.born;
  return w * Math.max(0, potOvr(p) - 45) * 0.7 * (age <= 21 ? 1 : age <= 23 ? 0.6 : 0.2);
}

function autoLineup(league: League, hitters: Player[], oppHand: 'L' | 'R', level: Level): { p: Player; pos: Pos }[] {
  const pool = [...hitters];
  // Regulars occasionally rest when there is a bench to cover.
  if (pool.length > 10) {
    // Rest follows fatigue: catchers wear down about 1.5x as fast.
    const restChance = (p: Player) => {
      const s = streak(league, p);
      return p.pos === 'C' ? 0.1 + 0.16 * Math.max(0, s - 3) : (level === 'MLB' ? 0.015 : 0.03) + 0.02 * Math.max(0, s - 7);
    };
    for (let i = pool.length - 1; i >= 0 && pool.length > 10; i--) if (rand() < restChance(pool[i])) pool.splice(i, 1);
  }
  const chosen: { p: Player; pos: Pos }[] = [];
  const used = new Set<number>();
  // In the minors, top prospects play every day. Two at one spot take turns
  // there; the other slides to a nearby position (building experience) or DH.
  if (level !== 'MLB' && hitters.length) {
    const top = topProspects(league, hitters[0].orgId!);
    const ps = hitters.filter((p) => top.has(p.id) && (pool.includes(p) || (top.get(p.id)! <= 10 && streak(league, p) < 9))).sort((a, b) => top.get(a.id)! - top.get(b.id)!);
    const byHome = new Map<string, Player[]>();
    for (const p of ps) byHome.set(p.pos, [...(byHome.get(p.pos) ?? []), p]);
    const taken = new Set<Pos>();
    let dhUsed = false;
    for (const [home, group] of byHome) {
      // Rotate who gets the home spot day to day.
      const order = group.map((_, i) => group[(i + league.day) % group.length]);
      for (const p of order) {
        if (!pool.includes(p)) pool.push(p);
        let spot: Pos | null = !taken.has(home as Pos) && home !== 'DH' ? (home as Pos) : null;
        if (!spot) spot = (NEARBY[home] ?? []).find((x) => !taken.has(x) && !(x === 'C' && home !== 'C')) ?? null;
        if (!spot && !dhUsed) { spot = 'DH'; dhUsed = true; }
        if (!spot) continue;
        taken.add(spot);
        used.add(p.id);
        chosen.push({ p, pos: spot });
      }
    }
  }
  for (const pos of FILL_ORDER) {
    if (chosen.some((c) => c.pos === pos)) continue;
    let best: Player | null = null;
    let bestV = -Infinity;
    for (const p of pool) {
      if (used.has(p.id)) continue;
      let v = offVs(p, oppHand) + defValue(p, pos) + devBonus(league, p, level);
      if (pos === 'C' && p.pos !== 'C') v -= 40;
      if (p.pos === pos) v += 4;
      if (v > bestV) {
        bestV = v;
        best = p;
      }
    }
    if (best) {
      used.add(best.id);
      chosen.push({ p: best, pos });
    }
  }
  const dh = chosen.some((c) => c.pos === 'DH') ? undefined : pool.filter((p) => !used.has(p.id)).sort((a, b) => offVs(b, oppHand) - offVs(a, oppHand))[0];
  if (dh) {
    used.add(dh.id);
    chosen.push({ p: dh, pos: 'DH' });
  }
  return battingOrder(chosen, oppHand);
}

// Batting order the way modern clubs build it: a high-OBP table setter leads
// off, the best hitter bats second, the best remaining power bat cleans up,
// and the rest follow in order of quality.
export function battingOrder<T extends { p: Player }>(slots: T[], hand: 'L' | 'R'): T[] {
  const o = [...slots].sort((a, b) => offVs(b.p, hand) - offVs(a.p, hand));
  const sp = (x: T) => (hand === 'L' ? x.p.ratings.vL : x.p.ratings.vR);
  const obp = (x: T) => sp(x).eye + 0.7 * sp(x).babip + 0.3 * x.p.ratings.run.speed - 0.3 * sp(x).power + 0.5 * offVs(x.p, hand);
  const take = (list: T[], f: (x: T) => number) => {
    const best = list.reduce((a, b) => (f(b) > f(a) ? b : a));
    list.splice(list.indexOf(best), 1);
    return best;
  };
  if (o.length < 5) return o;
  const top = o.slice(0, 5);
  const rest = o.slice(5);
  const lead = take(top, obp);
  const second = take(top, (x) => offVs(x.p, hand));
  const cleanup = take(top, (x) => sp(x).power + 0.5 * offVs(x.p, hand));
  const third = take(top, (x) => offVs(x.p, hand));
  return [lead, second, third, cleanup, ...top, ...rest];
}

export function postseasonEligible(league: League, p: Player): boolean {
  return !(league.phase === 'playoffs' && p.joined && p.joined.season === league.season && p.joined.day > league.settings.postseasonEligibilityDay);
}

export function buildLineup(league: League, orgId: number, level: Level, oppHand: 'L' | 'R' = 'R', sp?: Player): GameLineup | null {
  // Players acquired after August 31 aren't eligible for the postseason.
  const cutoff = league.settings.postseasonEligibilityDay;
  let roster = activeAt(league, orgId, level).filter(
    (p) => !p.injury && !(league.phase === 'playoffs' && p.joined && p.joined.season === league.season && p.joined.day > cutoff),
  );
  // Postseason: the 26 set for this round.
  const po = league.phase === 'playoffs' && level === 'MLB' ? playoffRosterFor(league, orgId) : null;
  if (po) roster = [...po].map((id) => league.players[id]).filter((p) => p && !p.injury && p.orgId === orgId);
  // Big leaguers on rehab assignments play here.
  if (level !== 'MLB') for (const p of orgPlayers(league, orgId)) if (p.rehab?.level === level && !p.injury && !roster.includes(p)) roster.push(p);
  const pitchers = roster.filter(isPitcher);
  const hitters = roster.filter((p) => !isPitcher(p));
  const org = league.orgs[orgId];
  const depth = org.depth[level];
  const starter = sp ?? pickStarter(league, orgId, level, pitchers, depth);
  if (!starter) return null;

  let batters: { p: Player; pos: Pos }[] = [];
  const manual = !!depth && !depth.auto && !(orgId === league.userOrgId && level === 'MLB' && delegated(league, org, 'depth'));
  // Platoon: a separate card against left-handed starters, if you've set one.
  const card = oppHand === 'L' && depth?.lineupL?.length === 9 ? depth.lineupL : depth?.lineup;
  if (manual && card && card.length === 9) {
    // Your lineup stands; anyone hurt or off the active roster is replaced in
    // his own spot by the best available bench player at that position.
    const used = new Set<number>();
    const slots: ({ p: Player; pos: Pos } | null)[] = card.map((s) => {
      const p = league.players[s.pid];
      if (!p || !hitters.includes(p) || used.has(p.id)) return null;
      used.add(p.id);
      return { p, pos: s.pos };
    });
    for (let i = 0; i < slots.length; i++) {
      if (slots[i]) continue;
      const pos = card[i].pos;
      let best: Player | null = null;
      let bestV = -Infinity;
      for (const p of hitters) {
        if (used.has(p.id)) continue;
        let v = offVs(p, oppHand) + devBonus(league, p, level);
        if (pos !== 'DH' && pos !== 'SP' && pos !== 'RP') {
          v += defValue(p, pos);
          if (pos === 'C' && p.pos !== 'C') v -= 40;
          if (p.pos === pos) v += 4;
        }
        if (v > bestV) {
          bestV = v;
          best = p;
        }
      }
      if (best) {
        used.add(best.id);
        slots[i] = { p: best, pos };
      }
    }
    if (slots.every(Boolean)) batters = slots as { p: Player; pos: Pos }[];
  }
  if (batters.length !== 9) batters = autoLineup(league, hitters, oppHand, level);
  // Too few healthy hitters: borrow pitchers to fill out the card.
  if (batters.length < 9) {
    const spare = pitchers.filter((p) => p !== starter);
    const needPos: Pos[] = ['C', 'SS', 'CF', '2B', '3B', 'RF', 'LF', '1B', 'DH'].filter((pos) => !batters.some((b) => b.pos === pos)) as Pos[];
    for (const pos of needPos) {
      const p = spare.shift();
      if (!p) break;
      batters.push({ p, pos });
    }
  }
  const inLineup = new Set(batters.map((b) => b.p.id));
  const bench = hitters.filter((p) => !inLineup.has(p.id));

  const bullpen = pitchers.filter((p) => p !== starter && !inLineup.has(p.id));
  let closer: Player | null = null;
  let setup: Player[] = [];
  const rps = bullpen.filter((p) => p.pos === 'RP').sort((a, b) => ovr(b) - ovr(a));
  if (manual && depth.closer !== null) {
    const c = league.players[depth.closer];
    if (c && bullpen.includes(c)) closer = c;
    setup = depth.setup.map((id) => league.players[id]).filter((p) => p && bullpen.includes(p) && p !== closer);
  }
  if (!closer) closer = rps[0] ?? null;
  if (setup.length < 2) setup = setup.concat(rps.filter((p) => p !== closer && !setup.includes(p)).slice(0, 2 - setup.length));
  const penStarters = league.phase === 'playoffs' && level === 'MLB' ? new Set(pitchers.filter((p) => p.pos === 'SP' && !rotationOf(league, orgId, level, pitchers, depth).includes(p)).map((p) => p.id)) : undefined;
  const roles = penRoles(bullpen, closer, setup, manual ? depth.pen : undefined, penStarters);

  const medical = 1 - 0.18 * deptEffect(org, 'medical');
  return { orgId, level, batters, sp: starter, bullpen, closer, setup, roles, medical, bench, mgr: managerMods(league, orgId, level), pInjury: pitcherInjuryMult(league, orgId, level) * medical };
}

export function blendedOffense(p: Player): number {
  return offense(blendSplits(p));
}

// Roles for every bullpen arm: your choices first, then the manager fills in
// (two long men with the most stamina, the weakest arm for mop-up, the rest in
// middle relief).
export function penRoles(allArms: Player[], closer: Player | null, setup: Player[], manual?: Record<number, PenRole>, penStarters?: Set<number>): Map<number, PenRole> {
  const roles = new Map<number, PenRole>();
  // Starters between turns aren't part of the bullpen unless the pen is short
  // (or it's the playoffs and he's not in the playoff rotation).
  const rps = allArms.filter((p) => p.pos !== 'SP' || manual?.[p.id] || penStarters?.has(p.id));
  const bullpen = rps.length >= 6 ? rps : allArms;
  if (closer) roles.set(closer.id, 'CL');
  for (const p of setup) roles.set(p.id, 'SU');
  for (const p of bullpen) {
    const r = manual?.[p.id];
    if (r && !roles.has(p.id) && r !== 'CL' && r !== 'SU') roles.set(p.id, r);
  }
  const rest = bullpen.filter((p) => !roles.has(p.id));
  const hasRole = (r: PenRole) => [...roles.values()].includes(r);
  if (!hasRole('LR')) {
    for (const p of [...rest].sort((a, b) => b.ratings.pit.stamina - a.ratings.pit.stamina).slice(0, Math.min(2, Math.max(0, rest.length - 2)))) roles.set(p.id, 'LR');
  }
  const rest2 = bullpen.filter((p) => !roles.has(p.id));
  if (!hasRole('MU') && rest2.length >= 2) roles.set([...rest2].sort((a, b) => ovr(a) - ovr(b))[0].id, 'MU');
  for (const p of bullpen) if (!roles.has(p.id)) roles.set(p.id, 'MR');
  return roles;
}
