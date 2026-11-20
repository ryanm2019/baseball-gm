// Organizational AI. AI clubs run everything automatically. For the user's
// club, the hired farm director runs every affiliate set to "Farm Director"
// control; MLB injury moves are handled only when "Auto MLB roster moves" is on.
import type { FarmDirector, League, Level, Org, Player } from './types.ts';
import { MINOR_LEVELS } from './types.ts';
import { LEVEL_AGE, LEVEL_TALENT } from './settings.ts';
import { isPitcher, ovr, perceivedOvr, potOvr } from './ratings.ts';
import { activeAt, activeLimit, addNews, countPitchers, fortyMan, orgPlayers, pitcherLimit, pname } from './util.ts';
import {
  activateFromIL,
  addTo40,
  assignPlayer,
  canActivate,
  canOption,
  designate,
  makeFreeAgent,
  optionPlayer,
  placeIL,
  placeOnWaivers,
  recallPlayer,
  selectContract,
  signFreeAgent,
} from './rules.ts';
import { generatePlayer } from './playerGen.ts';
import { milbContract } from './contracts.ts';

const CHAIN: Level[] = ['DSL', 'CPX', 'A', 'A+', 'AA', 'AAA'];
const MIN_FILL = 3; // affiliates keep within this many of their max

export function farmDirectorOf(league: League, org: Org): FarmDirector | undefined {
  return league.farmDirectors.find((f) => f.id === org.farmDirectorId);
}

export function isManaged(league: League, org: Org, level: Level): boolean {
  if (org.id !== league.userOrgId) return true;
  if (level === 'MLB') return league.settings.autoMlbMoves;
  return org.control[level] === 'FD' && org.farmDirectorId !== null;
}

function evalSd(league: League, org: Org): number {
  const fd = farmDirectorOf(league, org);
  const e = fd ? fd.evaluation : 35;
  return Math.max(0, ((80 - e) / 60) * 5);
}

const value = (league: League, org: Org, p: Player) => perceivedOvr(league, p, evalSd(league, org));
const prospectValue = (p: Player) => 0.4 * ovr(p) + 0.6 * potOvr(p);

function healthy(p: Player): boolean {
  return !p.injury && !p.il && !p.dfa && !p.waivers;
}

function sampleAt(league: League, p: Player, level: Level): { pa: number; outs: number; ops: number; era: number } {
  const e = p.stats.find((s) => s.season === league.season && s.level === level && s.orgId === p.orgId);
  if (!e) return { pa: 0, outs: 0, ops: 0, era: 0 };
  const b = e.bat;
  const ab = b.ab || 1;
  const obp = (b.h + b.bb + b.hbp) / Math.max(1, b.ab + b.bb + b.hbp + b.sf);
  const slg = (b.h + b.d + 2 * b.t + 3 * b.hr) / ab;
  return { pa: b.pa, outs: e.pit.outs, ops: obp + slg, era: e.pit.outs ? (e.pit.er * 27) / e.pit.outs : 0 };
}

const below = (level: Level): Level | null => {
  const i = CHAIN.indexOf(level);
  return i > 0 ? CHAIN[i - 1] : null;
};

// ---------- daily maintenance ----------

export function manageOrg(league: League, org: Org): void {
  const s = league.settings;
  const players = orgPlayers(league, org.id);
  const isUser = org.id === league.userOrgId;

  // 1. Injured list placement.
  for (const p of players) {
    if (p.injury && !p.il && p.level && isManaged(league, org, p.level) && p.injury.daysLeft >= 4) {
      placeIL(league, p);
    }
  }

  // 2. Activations.
  for (const p of players) {
    if (!p.il || p.injury) continue;
    const lvl = p.il.returnLevel;
    if (!isManaged(league, org, lvl)) continue;
    if (lvl === 'MLB') {
      let why = canActivate(league, p);
      if (why && (why.includes('roster is full') || why.includes('Pitcher limit'))) {
        makeMlbRoom(league, org, isPitcher(p), !isUser);
        why = canActivate(league, p);
      }
      if (why && why.includes('40-man')) {
        makeFortyRoom(league, org);
        why = canActivate(league, p);
      }
      if (!why) activateFromIL(league, p);
    } else if (!canActivate(league, p)) {
      activateFromIL(league, p);
    }
  }

  // 3. MLB roster size.
  if (isManaged(league, org, 'MLB')) {
    fillMlb(league, org, !isUser);
    trimMlb(league, org, !isUser);
  }

  // 4. DFA and waivers bookkeeping.
  for (const p of players) {
    if (!p.dfa) continue;
    if (!isUser || league.day - p.dfa.day >= s.dfaDays) {
      placeOnWaivers(league, p, 'outright');
      if (isUser) addNews(league, org.id, `${pname(p)}'s DFA period expired; he was placed on outright waivers.`, [p.id]);
    }
  }

  // 5. Affiliate rosters.
  for (const level of MINOR_LEVELS) {
    if (isManaged(league, org, level)) balanceAffiliate(league, org, level);
  }
}

function makeFortyRoom(league: League, org: Org): boolean {
  if (org.id === league.userOrgId && !isManaged(league, org, 'AAA')) return false;
  const cands = fortyMan(league, org.id).filter((p) => p.level !== 'MLB' && !p.il);
  if (!cands.length) return false;
  cands.sort((a, b) => prospectValue(a) - prospectValue(b));
  designate(league, cands[0]);
  return true;
}

function makeMlbRoom(league: League, org: Org, pitcher: boolean, allowDfa: boolean): boolean {
  const active = activeAt(league, org.id, 'MLB').filter((p) => isPitcher(p) === pitcher);
  const sorted = active.sort((a, b) => ovr(a) - ovr(b));
  for (const p of sorted) {
    if (!canOption(league, p)) {
      optionPlayer(league, p, 'AAA');
      return true;
    }
  }
  if (allowDfa && sorted.length) {
    designate(league, sorted[0]);
    return true;
  }
  return false;
}

function mlbNeed(league: League, org: Org): 'P' | 'C' | 'H' {
  const active = activeAt(league, org.id, 'MLB');
  const pitchers = countPitchers(active);
  const catchers = active.filter((p) => p.pos === 'C').length;
  const targetP = Math.min(pitcherLimit(league), activeLimit(league) === league.settings.activeMax ? 13 : 14);
  if (catchers < 2) return 'C';
  if (pitchers < targetP) return 'P';
  return 'H';
}

function fits(p: Player, need: 'P' | 'C' | 'H'): boolean {
  if (need === 'P') return isPitcher(p);
  if (need === 'C') return p.pos === 'C';
  return !isPitcher(p);
}

function fillMlb(league: League, org: Org, aiClub: boolean): void {
  for (let guard = 0; guard < 8; guard++) {
    const active = activeAt(league, org.id, 'MLB');
    if (active.length >= activeLimit(league)) return;
    let need = mlbNeed(league, org);
    if (need === 'P' && countPitchers(active) >= pitcherLimit(league)) need = 'H';
    const forty = fortyMan(league, org.id).filter((p) => p.level !== 'MLB' && healthy(p) && fits(p, need));
    forty.sort((a, b) => ovr(b) - ovr(a));
    if (forty.length) {
      recallPlayer(league, forty[0]);
      continue;
    }
    const pool = orgPlayers(league, org.id)
      .filter((p) => !p.on40 && (p.level === 'AAA' || p.level === 'AA') && healthy(p) && fits(p, need))
      .sort((a, b) => ovr(b) - ovr(a));
    if (!pool.length) {
      if (need === 'C' || need === 'P') {
        // fall back to any healthy player of the other kind rather than leave a hole
        const any = fortyMan(league, org.id).filter((p) => p.level !== 'MLB' && healthy(p)).sort((a, b) => ovr(b) - ovr(a));
        if (any.length && !(isPitcher(any[0]) && countPitchers(active) >= pitcherLimit(league))) {
          recallPlayer(league, any[0]);
          continue;
        }
      }
      return;
    }
    if (fortyMan(league, org.id).length >= league.settings.fortyMax) {
      if (!aiClub || !makeFortyRoom(league, org)) return;
    }
    selectContract(league, pool[0]);
  }
}

function trimMlb(league: League, org: Org, aiClub: boolean): void {
  for (let guard = 0; guard < 6; guard++) {
    const active = activeAt(league, org.id, 'MLB');
    const pitchers = countPitchers(active);
    if (active.length <= activeLimit(league) && pitchers <= pitcherLimit(league)) return;
    const pitcher = pitchers > pitcherLimit(league) || (pitchers > 13 && active.length > activeLimit(league));
    if (!makeMlbRoom(league, org, pitcher, aiClub)) return;
  }
}

// Too old to be sent to a lower level: real clubs release these players instead.
function tooOldFor(league: League, p: Player, level: Level): boolean {
  return league.season - p.born > LEVEL_AGE[level] + 3;
}

function lowerOrRelease(league: League, org: Org, p: Player, from: Level): void {
  const lower = below(from);
  if (lower && tooOldFor(league, p, lower) && !p.on40 && p.contract.type === 'MiLB') {
    makeFreeAgent(league, p, 'Released');
    return;
  }
  if (lower && isManaged(league, org, lower)) {
    assignPlayer(league, p, lower, 'Farm Director');
    return;
  }
  if (!p.on40 && p.contract.type === 'MiLB') makeFreeAgent(league, p, 'Released');
}

function balanceAffiliate(league: League, org: Org, level: Level): void {
  const max = league.settings.milbActiveMax[level];
  let active = activeAt(league, org.id, level);
  // Over the limit: move the weakest non-prospects down (or release at the bottom).
  let guard = 0;
  while (active.length > max && guard++ < 12) {
    const cands = active.filter((p) => !(p.optionedOnDay !== null && p.on40 && level === 'AAA'));
    const pool = cands.length ? cands : active;
    // Upper levels keep their best current players; lower levels keep their best prospects.
    const keep = level === 'AAA' || level === 'AA' ? ovr : prospectValue;
    pool.sort((a, b) => keep(a) - keep(b));
    lowerOrRelease(league, org, pool[0], level);
    active = activeAt(league, org.id, level);
  }
  // Under-staffed: pull up from below, then sign filler.
  const pitchers = countPitchers(active);
  const hitters = active.length - pitchers;
  const catchers = active.filter((p) => p.pos === 'C').length;
  const needs: ('P' | 'H' | 'C')[] = [];
  const half = Math.floor((max - MIN_FILL) / 2);
  for (let i = pitchers; i < half; i++) needs.push('P');
  for (let i = catchers; i < 2; i++) needs.push('C');
  for (let i = hitters + Math.max(0, 2 - catchers); i < half; i++) needs.push('H');
  for (const need of needs) {
    if (activeAt(league, org.id, level).length >= max) break;
    const lower = below(level);
    let moved = false;
    // Triple-A holes are usually filled with veteran free agents, as real clubs do.
    if (level === 'AAA' && signFiller(league, org, level, need, true)) continue;
    if (lower && isManaged(league, org, lower)) {
      const cands = activeAt(league, org.id, lower)
        .filter((p) => healthy(p) && fits(p, need === 'C' ? 'C' : need))
        .sort((a, b) => value(league, org, b) - value(league, org, a));
      // keep the lower level playable too
      const lowerActive = activeAt(league, org.id, lower).length;
      if (cands.length && lowerActive > league.settings.milbActiveMax[lower] - MIN_FILL - 4) {
        assignPlayer(league, cands[0], level, 'Farm Director');
        moved = true;
      }
    }
    if (!moved) signFiller(league, org, level, need);
  }
}

function signFiller(league: League, org: Org, level: Level, need: 'P' | 'H' | 'C', faOnly = false): boolean {
  const fa = Object.values(league.players)
    .filter((p) => p.orgId === null && fits(p, need === 'C' ? 'C' : need) && league.season - p.born <= (level === 'DSL' ? 20 : level === 'CPX' ? 23 : 34))
    .sort((a, b) => ovr(b) - ovr(a));
  const target = LEVEL_TALENT[level];
  const pick = fa.find((p) => ovr(p) <= target + 4 && ovr(p) >= target - 6);
  if (pick) {
    signFreeAgent(league, pick, org.id, level, false);
    return true;
  }
  if (faOnly) return false;
  const pos = need === 'P' ? (Math.random() < 0.45 ? 'SP' : 'RP') : need === 'C' ? 'C' : undefined;
  const p = generatePlayer({ id: league.nextId.player++, season: league.season, level, orgId: null, pos, talentShift: -2 });
  if (!pos && isPitcher(p)) p.pos = '1B';
  p.level = null;
  milbContract(p, league.season, level);
  league.players[p.id] = p;
  signFreeAgent(league, p, org.id, level, false);
  return true;
}

// ---------- weekly farm director review ----------

const PHIL = {
  Conservative: { offset: 1, pa: 220, outs: 150, maxMoves: 1 },
  Balanced: { offset: 0, pa: 150, outs: 105, maxMoves: 1 },
  Aggressive: { offset: -1.5, pa: 90, outs: 60, maxMoves: 2 },
};

export function farmDirectorReview(league: League, org: Org): void {
  const fd = farmDirectorOf(league, org);
  const phil = PHIL[fd?.philosophy ?? 'Balanced'];
  const isUser = org.id === league.userOrgId;
  const promos: string[] = [];

  for (let i = CHAIN.length - 2; i >= 0; i--) {
    const lower = CHAIN[i];
    const upper = CHAIN[i + 1];
    if (!isManaged(league, org, lower) || !isManaged(league, org, upper)) continue;
    const target = LEVEL_TALENT[upper] + phil.offset;
    const cands = activeAt(league, org.id, lower)
      .filter(healthy)
      .map((p) => ({ p, v: value(league, org, p) }))
      .sort((a, b) => b.v - a.v);
    let moves = 0;
    for (const { p, v } of cands) {
      if (moves >= phil.maxMoves) break;
      const a = league.season - p.born;
      const smp = sampleAt(league, p, lower);
      const pitcher = isPitcher(p);
      const enough = pitcher ? smp.outs >= phil.outs : smp.pa >= phil.pa;
      const performing = pitcher ? smp.outs < 30 || smp.era < 4.75 : smp.pa < 60 || smp.ops > 0.68;
      const tooOld = (lower === 'DSL' && a >= 20) || (lower === 'CPX' && a >= 22);
      const ready = (v >= target && enough && performing) || v >= LEVEL_TALENT[upper] + 5 || (tooOld && v >= LEVEL_TALENT[lower]);
      if (!ready) {
        if (v < target - 3) break;
        continue;
      }
      const up = activeAt(league, org.id, upper);
      const max = league.settings.milbActiveMax[upper];
      if (up.length >= max) {
        const same = up
          .filter((q) => healthy(q) && isPitcher(q) === pitcher && (p.pos === 'C') === (q.pos === 'C'))
          .filter((q) => !(q.on40 && upper === 'AAA'))
          // Veterans at a level are valued as depth, so they aren't bumped by marginal prospects.
          .map((q) => ({ q, v: value(league, org, q) + (league.season - q.born >= LEVEL_AGE[upper] ? 3 : 0) }))
          .sort((a2, b2) => a2.v - b2.v);
        if (!same.length || same[0].v > v - 3) continue;
        const bumped = same[0].q;
        if (tooOldFor(league, bumped, lower)) {
          if (bumped.on40 || bumped.contract.type !== 'MiLB' || same[0].v > v - 4) continue;
          makeFreeAgent(league, bumped, 'Released');
        } else {
          assignPlayer(league, bumped, lower, 'Farm Director');
        }
      }
      assignPlayer(league, p, upper, 'Farm Director');
      moves++;
      if (isUser) promos.push(`${pname(p)} (${lower} → ${upper})`);
    }
  }

  // Struggling, overmatched players drop a level.
  for (let i = CHAIN.length - 1; i >= 1; i--) {
    const level = CHAIN[i];
    const lower = CHAIN[i - 1];
    if (!isManaged(league, org, level) || !isManaged(league, org, lower)) continue;
    for (const p of activeAt(league, org.id, level).filter(healthy)) {
      if (p.on40 && level === 'AAA') continue;
      if (tooOldFor(league, p, lower)) continue;
      const smp = sampleAt(league, p, level);
      const v = value(league, org, p);
      const struggling = isPitcher(p) ? smp.outs >= 90 && smp.era > 6.5 : smp.pa >= 150 && smp.ops < 0.56;
      if (struggling && v < LEVEL_TALENT[level] - 3 && activeAt(league, org.id, lower).length < league.settings.milbActiveMax[lower]) {
        assignPlayer(league, p, lower, 'Farm Director');
        if (isUser) promos.push(`${pname(p)} (${level} → ${lower})`);
      }
    }
  }

  if (isUser && promos.length && fd) {
    addNews(league, org.id, `Farm director ${fd.first} ${fd.last} moved: ${promos.join(', ')}.`);
  }

  if (!isUser) aiMlbReview(league, org);
}

// AI clubs swap clearly better AAA 40-man players onto the MLB roster.
function aiMlbReview(league: League, org: Org): void {
  const active = activeAt(league, org.id, 'MLB');
  const forty = fortyMan(league, org.id).filter((p) => p.level === 'AAA' && healthy(p));
  for (const pitcher of [true, false]) {
    const best = forty.filter((p) => isPitcher(p) === pitcher).sort((a, b) => ovr(b) - ovr(a))[0];
    if (!best) continue;
    const worst = active
      .filter((p) => isPitcher(p) === pitcher && !canOption(league, p))
      .filter((p) => !(p.pos === 'C' && active.filter((q) => q.pos === 'C').length <= 2))
      .sort((a, b) => ovr(a) - ovr(b))[0];
    if (worst && ovr(best) > ovr(worst) + 4) {
      optionPlayer(league, worst, 'AAA');
      recallPlayer(league, best);
    }
  }
  // Add top upper-minors prospects to the 40-man when there is room.
  const forty2 = fortyMan(league, org.id);
  if (forty2.length < league.settings.fortyMax - 1) {
    const prospect = orgPlayers(league, org.id)
      .filter((p) => !p.on40 && (p.level === 'AAA' || p.level === 'AA') && healthy(p) && ovr(p) >= LEVEL_TALENT.MLB - 6)
      .sort((a, b) => prospectValue(b) - prospectValue(a))[0];
    if (prospect) addTo40(league, prospect);
  }
}

export function hireFarmDirector(league: League, org: Org, fd: FarmDirector): string | null {
  if (fd.orgId !== null) return 'Already employed';
  const cur = farmDirectorOf(league, org);
  if (cur) cur.orgId = null;
  fd.orgId = org.id;
  fd.exp = league.season + 2;
  org.farmDirectorId = fd.id;
  addNews(league, org.id, `Hired ${fd.first} ${fd.last} as farm director.`);
  return null;
}

export function fireFarmDirector(league: League, org: Org): void {
  const cur = farmDirectorOf(league, org);
  if (!cur) return;
  cur.orgId = null;
  org.farmDirectorId = null;
  addNews(league, org.id, `Fired farm director ${cur.first} ${cur.last}. Affiliates now need manual management until a new farm director is hired.`);
}

