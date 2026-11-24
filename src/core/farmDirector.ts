// Organizational AI. AI clubs run everything automatically. For the user's
// club, the hired farm director runs every affiliate set to "Farm Director"
// control; MLB injury moves are handled only when "Auto MLB roster moves" is on.
import type { FarmDirector, League, Level, Org, Player } from './types.ts';
import { MINOR_LEVELS } from './types.ts';
import type { InboxMsg } from './types.ts';
import { addInbox } from './morale.ts';
import { LEVEL_AGE, LEVEL_TALENT } from './settings.ts';
import { isPitcher, ovr, perceivedOvr, potOvr } from './ratings.ts';
import { activeAt, activeLimit, addNews, countPitchers, fortyMan, orgPlayers, pitcherLimit, pname } from './util.ts';
import {
  activateFromIL,
  addTo40,
  assignPlayer,
  canActivate,
  canOption,
  canRecall,
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
import { rand } from './random.ts';
import { delegated, staffOf } from './staff.ts';
import { isFreeAgent, isMinorFA } from './freeAgency.ts';
import { milbContract } from './contracts.ts';

const CHAIN: Level[] = ['DSL', 'CPX', 'A', 'A+', 'AA', 'AAA'];
const MIN_FILL = 3; // affiliates keep within this many of their max

export function farmDirectorOf(league: League, org: Org): FarmDirector | undefined {
  return staffOf(league, org, 'FD');
}

// Whether the AI handles roster upkeep at this level. For the user's MLB club
// that is the assistant GM's "injuries" duty; for affiliates, the farm director.
export function isManaged(league: League, org: Org, level: Level): boolean {
  if (org.id !== league.userOrgId) return true;
  if (level === 'MLB') return delegated(league, org, 'injuries');
  return org.control[level] === 'FD' && org.staff.FD !== undefined;
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
  const tx0 = league.transactions.length;

  // 1. Injured list placement.
  for (const p of players) {
    if (p.injury && !p.il && p.level && isManaged(league, org, p.level) && p.injury.daysLeft >= 4) {
      placeIL(league, p);
    }
  }

  // 2. Activations.
  for (const p of players) {
    if (!p.il || p.injury || p.rehab) continue;
    const lvl = p.il.returnLevel;
    if (!isManaged(league, org, lvl)) continue;
    if (lvl === 'MLB') {
      let why = canActivate(league, p);
      const txBefore = league.transactions.length;
      if (why && (why.includes('roster is full') || why.includes('Pitcher limit'))) {
        makeMlbRoom(league, org, isPitcher(p), !isUser);
        why = canActivate(league, p);
      }
      if (why && why.includes('40-man')) {
        makeFortyRoom(league, org);
        why = canActivate(league, p);
      }
      if (!why) {
        activateFromIL(league, p);
        // Your assistant GM handled it: let you know what he did, and who made room.
        if (isUser) {
          const txs = league.transactions.slice(txBefore).filter((t) => t.orgId === org.id && !t.pids.includes(p.id));
          const moves = txs.map((t) => t.text);
          addInbox(league, { from: 'Assistant GM', subject: `${pname(p)} activated from the IL`, kind: 'info', pids: [p.id, ...new Set(txs.flatMap((t) => t.pids))], text: `${pname(p)} is healthy, so I activated him from the IL.${moves.length ? ` To make room: ${moves.join('; ')}.` : ' There was room, so no one had to go down.'}` });
        }
      }
    } else if (!canActivate(league, p)) {
      activateFromIL(league, p);
    }
  }

  // 3. MLB roster size (and 40-man for clubs whose roster the AI runs).
  if (!isUser || delegated(league, org, 'roster')) {
    for (let g = 0; g < 5 && fortyMan(league, org.id).length > league.settings.fortyMax; g++) if (!makeFortyRoom(league, org)) break;
  }
  // When the assistant GM runs your MLB roster he can clear 40-man space too
  // (otherwise a full 40-man could leave the active roster short).
  const aiRoster = !isUser || delegated(league, org, 'roster');
  if (isManaged(league, org, 'MLB')) fillMlb(league, org, aiRoster);
  if (delegated(league, org, 'roster')) trimMlb(league, org, aiRoster);
  if (aiRoster && league.phase === 'regular') shuttleRelievers(league, org);

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

  // Tell the user about MLB injury moves the assistant GM made on his behalf,
  // including the corresponding roster move.
  if (isUser) {
    const MLB_TYPES = ['IL', 'Activate', 'Recall', 'Select', 'Option', 'DFA'];
    const tx = league.transactions.slice(tx0).filter((t) => t.orgId === org.id && MLB_TYPES.includes(t.type) && !t.text.includes('minor league'));
    if (tx.some((t) => t.type === 'IL' || t.type === 'Activate')) {
      const agm = staffOf(league, org, 'AGM');
      const who = agm ? `Assistant GM ${agm.first} ${agm.last}` : 'Your staff';
      addNews(league, org.id, `${who}: ${tx.map((t) => t.text).join('; ')}.`, [...new Set(tx.flatMap((t) => t.pids))]);
    }
  }
}

// Real clubs cycle tired relievers: option one who's been worked hard and
// recall a rested arm from Triple-A (at most one swap a day).
function shuttleRelievers(league: League, org: Org): void {
  if (rand() > 0.5) return;
  const day = league.day;
  const worked = (p: Player) => (p.recentApps ?? []).filter((d) => d > day - 5).length;
  const tired = activeAt(league, org.id, 'MLB')
    .filter((p) => p.pos === 'RP' && !p.il && worked(p) >= 3 && !canOption(league, p) && org.depth.MLB?.closer !== p.id)
    .sort((a, b) => worked(b) - worked(a) || ovr(a) - ovr(b))[0];
  if (!tired) return;
  const fresh = fortyMan(league, org.id)
    .filter((p) => p.level === 'AAA' && isPitcher(p) && !p.injury && !p.il && !canRecall(league, p) && day - p.lastPitchedDay >= 2)
    .sort((a, b) => ovr(b) - ovr(a))[0];
  if (!fresh || ovr(fresh) < ovr(tired) - 6) return;
  optionPlayer(league, tired, 'AAA');
  recallPlayer(league, fresh);
}

function makeFortyRoom(league: League, org: Org): boolean {
  if (org.id === league.userOrgId && !isManaged(league, org, 'AAA')) return false;
  const cands = fortyMan(league, org.id).filter((p) => p.level !== 'MLB' && !p.il);
  if (!cands.length) return false;
  cands.sort((a, b) => prospectValue(a) - prospectValue(b));
  designate(league, cands[0]);
  return true;
}

// Who goes down to make room: the weakest optionable player of that kind
// (never the second catcher), else (if allowed) the weakest one is designated.
export function mlbRoomCandidate(league: League, org: Org, pitcher: boolean, allowDfa: boolean): { p: Player; dfa: boolean } | null {
  const all = activeAt(league, org.id, 'MLB');
  const catchers = all.filter((p) => p.pos === 'C').length;
  const active = all.filter((p) => isPitcher(p) === pitcher && !(p.pos === 'C' && catchers <= 2));
  const sorted = active.sort((a, b) => ovr(a) - ovr(b));
  const opt = sorted.find((p) => !canOption(league, p));
  if (opt) return { p: opt, dfa: false };
  return allowDfa && sorted.length ? { p: sorted[0], dfa: true } : null;
}

export function makeMlbRoom(league: League, org: Org, pitcher: boolean, allowDfa: boolean): boolean {
  const c = mlbRoomCandidate(league, org, pitcher, allowDfa);
  if (!c) return false;
  if (c.dfa) designate(league, c.p);
  else optionPlayer(league, c.p, 'AAA');
  return true;
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
    const fillKey = (p: typeof forty[0]) => ovr(p) - (league.season - p.born <= 22 ? 4 : 0);
    forty.sort((a, b) => fillKey(b) - fillKey(a));
    if (forty.length) {
      recallPlayer(league, forty[0]);
      continue;
    }
    const pool = orgPlayers(league, org.id)
      .filter((p) => !p.on40 && (p.level === 'AAA' || p.level === 'AA') && healthy(p) && fits(p, need))
      .sort((a, b) => fillKey(b) - fillKey(a));
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
        // Filling a hole: prefer players old enough for the level.
        .sort((a, b) => value(league, org, b) - 1.5 * Math.max(0, LEVEL_AGE[level] - 3 - (league.season - b.born)) - (value(league, org, a) - 1.5 * Math.max(0, LEVEL_AGE[level] - 3 - (league.season - a.born))));
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
    .filter((p) => isFreeAgent(p) && isMinorFA(league, p) && !p.fa?.milbOffers?.length && fits(p, need === 'C' ? 'C' : need) && league.season - p.born <= (level === 'DSL' ? 20 : level === 'CPX' ? 23 : 34))
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
  const promoIds: number[] = [];

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
      // No age limits, but young-for-the-level players are brought along slowly:
      // the younger he is, the better he has to be and the longer he has to do it
      // first. A generational talent still gets there; a good teenager waits.
      const youngFor = Math.max(0, LEVEL_AGE[upper] - 3 - a);
      const bar = 2.2 * youngFor;
      const sampleMult = 1 + 0.8 * youngFor;
      const longEnough = pitcher ? smp.outs >= phil.outs * sampleMult : smp.pa >= phil.pa * sampleMult;
      const standout = v >= LEVEL_TALENT[upper] + 5 + bar && (pitcher ? smp.outs >= 45 * sampleMult : smp.pa >= 60 * sampleMult);
      const ready = (v >= target + bar && longEnough && performing) || standout || (tooOld && v >= LEVEL_TALENT[lower]);
      if (!ready) {
        if (v < target - 3) break;
        continue;
      }
      void enough;
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
      if (isUser) {
        promos.push(`${pname(p)} (${lower} → ${upper})`);
        promoIds.push(p.id);
      }
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
        if (isUser) {
          promos.push(`${pname(p)} (${level} → ${lower})`);
          promoIds.push(p.id);
        }
      }
    }
  }

  if (isUser && promos.length && fd) {
    addNews(league, org.id, `Farm director ${fd.first} ${fd.last} moved: ${promos.join(', ')}.`, promoIds);
  }

  if (delegated(league, org, 'roster')) aiMlbReview(league, org);
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

// ---------- telling you when a player can come off the MLB injured list ----------

const MLB_IL = ['IL10', 'IL15', 'IL60'];

// Daily (in season): a healthy player who has served his minimum stay, with no
// rehab assignment running, gets a message that stops the sim, unless your
// assistant GM handles injuries (then he activates him and tells you).
export function ilReadyNotices(league: League): void {
  if (league.phase !== 'regular') return;
  const org = league.orgs[league.userOrgId];
  if (isManaged(league, org, 'MLB')) return;
  for (const p of orgPlayers(league, org.id)) {
    if (!p.il || !MLB_IL.includes(p.il.type) || p.injury || p.rehab) continue;
    if (p.il.readyNoticeDay !== undefined && league.day - p.il.readyNoticeDay < 7) continue;
    if ((league.inbox ?? []).some((m) => m.kind === 'il-ready' && m.pids[0] === p.id && !m.resolved)) continue;
    const why = canActivate(league, p);
    if (why && !why.includes('roster is full') && !why.includes('Pitcher limit') && !why.includes('40-man')) continue;
    p.il.readyNoticeDay = league.day;
    const roomy = why && (why.includes('roster is full') || why.includes('Pitcher limit'));
    const down = roomy ? mlbRoomCandidate(league, org, isPitcher(p), false) : null;
    const full = !why ? '' : down ? ` Your active roster is full: activating him now would option ${pname(down.p)} to ${league.orgs[org.id].affiliates.AAA.name}.` : ` Your active roster is full and no one can be optioned; make room on Roster Moves first.`;
    addInbox(league, {
      from: 'Medical staff', subject: `${pname(p)} is ready to come off the IL`, kind: 'il-ready', pids: down ? [p.id, down.p.id] : [p.id], stop: true,
      text: `${pname(p)} is healthy and has served his minimum stay on the ${p.il.type}.${full}`,
      actions: [
        { key: 'activate', label: down ? `Activate (option ${down.p.first[0]}. ${down.p.last})` : 'Activate now' },
        { key: 'rehab', label: 'Rehab assignment first (about a week)' },
        { key: 'leave', label: 'Leave him on the IL for now' },
      ],
      link: { page: 'roster-moves' },
    });
  }
}

export function answerIlReady(league: League, msg: InboxMsg, key: string): string {
  const p = league.players[msg.pids[0]];
  const label = msg.actions?.find((a) => a.key === key)?.label ?? key;
  msg.read = true;
  if (!p || !p.il || p.orgId !== league.userOrgId) { msg.resolved = 'Already handled'; return 'He is no longer on your IL.'; }
  if (key === 'leave') { msg.resolved = label; return `${pname(p)} stays on the IL. We'll remind you in a week.`; }
  if (key === 'rehab') {
    p.rehab = { level: 'AAA', daysLeft: 7, total: 7 };
    p.il.readyNoticeDay = undefined;
    msg.resolved = label;
    return `${pname(p)} begins a rehab assignment with ${league.orgs[p.orgId].affiliates.AAA.name} (about a week). You'll hear when it's done.`;
  }
  const org = league.orgs[league.userOrgId];
  let why = canActivate(league, p);
  const txBefore = league.transactions.length;
  if (why && (why.includes('roster is full') || why.includes('Pitcher limit'))) {
    makeMlbRoom(league, org, isPitcher(p), false);
    why = canActivate(league, p);
  }
  if (why) return `Can't activate him yet: ${why}. Make room on Roster Moves, then activate him there.`;
  activateFromIL(league, p);
  msg.resolved = label;
  const moves = league.transactions.slice(txBefore).map((t) => t.text).filter((t) => !t.includes(p.last));
  return `${pname(p)} is activated.${moves.length ? ` ${moves.join('; ')}.` : ''}`;
}
