// Builds a game-day lineup, starting pitcher and bullpen for one team at one level.
import type { DepthChart, FieldPos, League, Level, Player, Pos } from '../types.ts';
import { blendSplits, isPitcher, offense, ovr, posRating } from '../ratings.ts';
import { activeAt } from '../util.ts';
import { rand } from '../random.ts';
import { delegated, managerMods, pitcherInjuryMult, type ManagerMods } from '../staff.ts';

export interface GameLineup {
  orgId: number;
  level: Level;
  batters: { p: Player; pos: Pos }[];
  sp: Player;
  bullpen: Player[];
  closer: Player | null;
  setup: Player[];
  bench: Player[];
  mgr: ManagerMods;
  pInjury: number;
}

const FILL_ORDER: FieldPos[] = ['C', 'SS', 'CF', '2B', '3B', 'RF', 'LF', '1B'];

export const offVs = (p: Player, hand: 'L' | 'R'): number => offense(hand === 'L' ? p.ratings.vL : p.ratings.vR);

export function restDays(league: League, p: Player): number {
  return league.day - p.lastStartDay;
}

export function pickStarter(league: League, orgId: number, level: Level, pitchers: Player[], depth: DepthChart | undefined): Player | null {
  const org = league.orgs[orgId];
  let rotation: Player[] = [];
  if (depth && !depth.auto && depth.rotation.length && !(orgId === league.userOrgId && level === 'MLB' && delegated(league, org, 'depth'))) {
    rotation = depth.rotation.map((id) => league.players[id]).filter((p) => p && pitchers.includes(p));
  }
  if (rotation.length < 5) {
    const sps = pitchers
      .filter((p) => !rotation.includes(p))
      .sort((a, b) => (b.pos === 'SP' ? 1 : 0) - (a.pos === 'SP' ? 1 : 0) || b.ratings.pit.stamina - a.ratings.pit.stamina + (ovr(b) - ovr(a)) * 0.5);
    const auto = sps.filter((p) => p.pos === 'SP' || p.ratings.pit.stamina >= 45);
    rotation = rotation.concat(auto.slice(0, 5 - rotation.length));
  }
  if (rotation.length === 0) rotation = [...pitchers].sort((a, b) => b.ratings.pit.stamina - a.ratings.pit.stamina).slice(0, 5);
  if (rotation.length === 0) return null;
  const idx = org.rotationIndex[level] ?? 0;
  for (let k = 0; k < rotation.length; k++) {
    const p = rotation[(idx + k) % rotation.length];
    if (restDays(league, p) >= 5 && league.day - p.lastPitchedDay >= 2) {
      org.rotationIndex[level] = (idx + k + 1) % rotation.length;
      return p;
    }
  }
  // Nobody fully rested: spot start the most rested arm.
  const all = [...pitchers].sort((a, b) => restDays(league, b) - restDays(league, a) || b.ratings.pit.stamina - a.ratings.pit.stamina);
  return all[0] ?? null;
}

function autoLineup(hitters: Player[], oppHand: 'L' | 'R', level: Level): { p: Player; pos: Pos }[] {
  const pool = [...hitters];
  // Regulars occasionally rest when there is a bench to cover.
  if (pool.length > 10) {
    const restChance = (p: Player) => (p.pos === 'C' ? 0.16 : level === 'MLB' ? 0.05 : 0.08);
    for (let i = pool.length - 1; i >= 0 && pool.length > 10; i--) if (rand() < restChance(pool[i])) pool.splice(i, 1);
  }
  const chosen: { p: Player; pos: Pos }[] = [];
  const used = new Set<number>();
  for (const pos of FILL_ORDER) {
    let best: Player | null = null;
    let bestV = -Infinity;
    for (const p of pool) {
      if (used.has(p.id)) continue;
      const d = posRating(p.ratings.def, pos);
      let v = offVs(p, oppHand) + 0.6 * (d - 50);
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
  const dh = pool.filter((p) => !used.has(p.id)).sort((a, b) => offVs(b, oppHand) - offVs(a, oppHand))[0];
  if (dh) {
    used.add(dh.id);
    chosen.push({ p: dh, pos: 'DH' });
  }
  const o = chosen.sort((a, b) => offVs(b.p, oppHand) - offVs(a.p, oppHand));
  // Best hitters at 1-4; table setter with OBP/speed leads off.
  const order = [o[2], o[0], o[1], o[3], ...o.slice(4)].filter(Boolean);
  return order;
}

export function postseasonEligible(league: League, p: Player): boolean {
  return !(league.phase === 'playoffs' && p.joined && p.joined.season === league.season && p.joined.day > league.settings.postseasonEligibilityDay);
}

export function buildLineup(league: League, orgId: number, level: Level, oppHand: 'L' | 'R' = 'R', sp?: Player): GameLineup | null {
  // Players acquired after August 31 aren't eligible for the postseason.
  const cutoff = league.settings.postseasonEligibilityDay;
  const roster = activeAt(league, orgId, level).filter(
    (p) => !p.injury && !(league.phase === 'playoffs' && p.joined && p.joined.season === league.season && p.joined.day > cutoff),
  );
  const pitchers = roster.filter(isPitcher);
  const hitters = roster.filter((p) => !isPitcher(p));
  const org = league.orgs[orgId];
  const depth = org.depth[level];
  const starter = sp ?? pickStarter(league, orgId, level, pitchers, depth);
  if (!starter) return null;

  let batters: { p: Player; pos: Pos }[] = [];
  const manual = !!depth && !depth.auto && !(orgId === league.userOrgId && level === 'MLB' && delegated(league, org, 'depth'));
  if (manual && depth.lineup.length === 9) {
    // Your lineup stands; anyone hurt or off the active roster is replaced in
    // his own spot by the best available bench player at that position.
    const used = new Set<number>();
    const slots: ({ p: Player; pos: Pos } | null)[] = depth.lineup.map((s) => {
      const p = league.players[s.pid];
      if (!p || !hitters.includes(p) || used.has(p.id)) return null;
      used.add(p.id);
      return { p, pos: s.pos };
    });
    for (let i = 0; i < slots.length; i++) {
      if (slots[i]) continue;
      const pos = depth.lineup[i].pos;
      let best: Player | null = null;
      let bestV = -Infinity;
      for (const p of hitters) {
        if (used.has(p.id)) continue;
        let v = offVs(p, oppHand);
        if (pos !== 'DH' && pos !== 'SP' && pos !== 'RP') {
          v += 0.6 * (posRating(p.ratings.def, pos) - 50);
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
  if (batters.length !== 9) batters = autoLineup(hitters, oppHand, level);
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

  return { orgId, level, batters, sp: starter, bullpen, closer, setup, bench, mgr: managerMods(league, orgId, level), pInjury: pitcherInjuryMult(league, orgId, level) };
}

export function blendedOffense(p: Player): number {
  return offense(blendSplits(p));
}
