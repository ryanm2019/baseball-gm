// Position changes: moving a hitter to a new spot or a pitcher between the
// rotation and the bullpen, how it develops, the scouts' read, and AI moves.
//
// Hitters: each player's hidden aptitude, adaptation pace and ceiling at a
// position (ratings.ts) decide whether a move makes him better or worse and
// whether he ever settles in. Experience comes from games played there
// (spring training counts double).
//
// Pitchers: a reliever moved to the rotation is stretched out gradually (his
// pitch limit grows start by start, or through spring training); a starter
// moved to the pen sees his stuff play up in short stints.
import type { FieldPos, League, Level, Org, Player, Pos } from './types.ts';
import { FIELD_POSITIONS, adaptCap, aptitude, defAt, hitterOvrAt, isPitcher, offense, blendSplits, ovr, pitcherOvr, posExp, posRating, scoutFactor } from './ratings.ts';
import { clamp, rand, seededNormal, shuffle } from './random.ts';
import { activeAt, addTransaction, orgPlayers, pname } from './util.ts';
import { addInbox, moraleEvent } from './morale.ts';
import type { GameLineup } from './sim/lineup.ts';
import { adaptSpeed } from './ratings.ts';

// Defensive spectrum: moving right-to-left is a "move down".
const SPECTRUM: Pos[] = ['DH', '1B', 'LF', 'RF', '3B', 'CF', '2B', 'SS', 'C'];

function ensureInfo(p: Player): void {
  p.posInfo ??= { home: p.pos, exp: {} };
}

// Overall at a position given his current comfort there.
export function ovrAt(p: Player, pos: Pos): number {
  if (isPitcher(p)) return ovr(p);
  const def = pos === 'DH' ? 50 : defAt(p, pos as FieldPos);
  return hitterOvrAt(offense(blendSplits(p)), def, p.ratings.run.speed, pos);
}

// For deciding who plays where: the position value plus extra weight on the
// glove up the middle (and a bit less at first base).
const DEF_EXTRA: Partial<Record<Pos, number>> = { C: 0.3, SS: 0.3, CF: 0.25, '2B': 0.2, '3B': 0.15, RF: 0.05, '1B': -0.1 };
export function fieldValue(p: Player, pos: Pos): number {
  if (isPitcher(p) || pos === 'DH') return ovrAt(p, pos);
  return ovrAt(p, pos) + (DEF_EXTRA[pos] ?? 0) * (defAt(p, pos as FieldPos) - 50);
}

// ---------- the scouts' read ----------

export type Fit = 'Natural' | 'Good fit' | 'Can handle it' | 'Stretch' | 'Not a fit';

export interface PosRead { pos: Pos; fit: Fit; now: number; projected: number; exp: number }

// What your scouts think he'd be at each position once settled in (noisy).
export function positionReads(league: League, org: Org, p: Player): PosRead[] {
  if (isPitcher(p)) return [];
  const f = scoutFactor(league, org, p.orgId === org.id ? 'own' : 'pro');
  const off = offense(blendSplits(p));
  return [...FIELD_POSITIONS, 'DH' as Pos].map((pos) => {
    if (pos === 'DH') {
      const v = hitterOvrAt(off, 50, p.ratings.run.speed, 'DH');
      return { pos, fit: 'Can handle it' as Fit, now: v, projected: v, exp: 100 };
    }
    const fp = pos as FieldPos;
    const raw = posRating(p.ratings.def, fp);
    const settled = (p.posInfo?.home ?? p.pos) === fp ? raw : raw + aptitude(p, fp) * adaptCap(p, fp) - (adaptCap(p, fp) < 1 ? 6 * (1 - adaptCap(p, fp)) : 0);
    const read = settled + 6 * f * seededNormal(p.scoutSeed, org.id, FIELD_POSITIONS.indexOf(fp), 4242);
    const fit: Fit = read >= 60 ? 'Natural' : read >= 52 ? 'Good fit' : read >= 45 ? 'Can handle it' : read >= 37 ? 'Stretch' : 'Not a fit';
    // Poor fits rarely settle in all the way: project him partly adapted.
    const learn = { C: 16, '1B': 4, '2B': 7, '3B': 6, SS: 10, LF: 4, CF: 8, RF: 4 }[fp];
    const projDef = fit === 'Not a fit' ? read - learn * 0.6 : fit === 'Stretch' ? read - learn * 0.3 : read;
    return { pos, fit, now: ovrAt(p, pos), projected: hitterOvrAt(off, projDef, p.ratings.run.speed, pos), exp: posExp(p, fp) };
  });
}

// ---------- making the move ----------

export function canStart(p: Player): string | null {
  const usable = Object.values(p.ratings.pit.pitches).filter((x) => x >= 40).length;
  if (usable < 3) return `He has only ${usable} usable pitch${usable === 1 ? '' : 'es'}; starters usually need three`;
  if (p.pot.stamina < 40) return 'His arm may not hold up to starting (low stamina potential)';
  return null;
}

export function changePosition(league: League, p: Player, pos: Pos, why = ''): string {
  if (pos === p.pos) return 'Already his position';
  const old = p.pos;
  if (isPitcher(p) !== (pos === 'SP' || pos === 'RP')) return "Two-way players aren't supported yet";
  if (pos === 'SP') {
    // Stretch him out: the pitch limit grows each start (or through spring).
    p.stretch = { limit: league.phase === 'preseason' || league.phase === 'offseason' ? 45 : 40 };
    p.pos = 'SP';
  } else if (pos === 'RP') {
    p.stretch = null;
    p.pos = 'RP';
  } else {
    ensureInfo(p);
    p.pos = pos;
    const down = SPECTRUM.indexOf(pos) < SPECTRUM.indexOf(old);
    if (down && p.personality.loyalty < 60) moraleEvent(league, p, -3, `Moved from ${old} to ${pos}`);
  }
  if (p.orgId !== null) addTransaction(league, p.orgId, 'Position', `Moved ${pname(p)} from ${old} to ${pos}${why ? ` (${why})` : ''}`, [p.id]);
  return `${pname(p)} is now a ${pos}${pos === 'SP' && old === 'RP' ? ': he will be stretched out over his next several starts' : ''}.`;
}

// Games in a row he's started (0 if he sat yesterday).
export function streak(league: League, p: Player): number {
  if (p.orgId === null || !p.level || p.straightDay === undefined) return 0;
  const last = league.orgs[p.orgId].lastGameDay?.[p.level];
  return last !== undefined && p.straightDay === last ? p.straight ?? 0 : 0;
}

// A worn-down catcher frames and hits a little worse (rating points).
export function catcherFatigue(league: League, p: Player): number {
  return Math.min(3, Math.max(0, streak(league, p) - 5) * 0.8);
}

// ---------- experience ----------

// After each game: the positions played build experience.
export function gainFromGame(league: League, lu: GameLineup): void {
  // Fatigue: consecutive team games started (off days don't count as rest).
  const org = league.orgs[lu.orgId];
  org.lastGameDay ??= {};
  const prev = org.lastGameDay[lu.level];
  org.lastGameDay[lu.level] = league.day;
  for (const b of lu.batters) {
    b.p.straight = prev !== undefined && b.p.straightDay === prev ? (b.p.straight ?? 0) + 1 : 1;
    b.p.straightDay = league.day;
    if (b.pos === 'DH' || isPitcher(b.p)) continue;
    const fp = b.pos as FieldPos;
    const home = b.p.posInfo?.home ?? b.p.pos;
    if (home === fp) continue;
    ensureInfo(b.p);
    const e = b.p.posInfo!.exp[fp] ?? posExp(b.p, fp);
    b.p.posInfo!.exp[fp] = clamp(e + 2.2 * adaptSpeed(league, b.p, fp), 0, 100);
  }
}

// Spring training: daily work at his new position counts double; relievers
// moved to the rotation get stretched out.
export function springWork(league: League): void {
  for (const p of Object.values(league.players)) {
    if (p.orgId === null || p.retired) continue;
    if (p.stretch) p.stretch.limit = Math.min(110, p.stretch.limit + 3);
    if (isPitcher(p) || !p.posInfo) continue;
    const fp = p.pos as FieldPos;
    if (p.pos === 'DH' || p.posInfo.home === fp) continue;
    const e = p.posInfo.exp[fp] ?? posExp(p, fp);
    p.posInfo.exp[fp] = clamp(e + 4.4 * adaptSpeed(league, p, fp) * 0.6, 0, 100);
  }
}

// After a start: the stretched-out reliever's limit grows 10-15 pitches.
export function afterStart(p: Player): void {
  if (!p.stretch) return;
  p.stretch.limit += 10 + Math.floor(rand() * 6);
  if (p.stretch.limit >= 100) p.stretch = null;
}

// ---------- AI and your farm director ----------

// The best move for a player, judged with the club's scouting (null if none).
function bestMove(league: League, org: Org, p: Player): { pos: Pos; gain: number; projected: number } | null {
  if (isPitcher(p)) {
    const asSp = pitcherOvr(p.ratings.pit.stuff, p.ratings.pit.movement, p.ratings.pit.control, p.ratings.pit.stamina, 'SP');
    const asRp = pitcherOvr(p.ratings.pit.stuff, p.ratings.pit.movement, p.ratings.pit.control, p.ratings.pit.stamina, 'RP');
    // A starter who'd be a much better reliever, or a reliever with a starter's arsenal and arm.
    if (p.pos === 'SP' && asRp - asSp >= 4 && league.season - p.born >= 25) return { pos: 'RP', gain: asRp - asSp, projected: asRp };
    if (p.pos === 'RP' && !canStart(p) && asSp - asRp >= 2 && p.ratings.pit.stamina >= 45) return { pos: 'SP', gain: asSp - asRp, projected: asSp };
    return null;
  }
  const reads = positionReads(league, org, p);
  const cur = reads.find((r) => r.pos === p.pos);
  if (!cur) return null;
  const mlb = activeAt(league, org.id, 'MLB').filter((x) => !isPitcher(x) && x.id !== p.id);
  const bestAt = (pos: Pos) => mlb.filter((x) => x.pos === pos).map((x) => ovr(x)).sort((a, b) => b - a)[0] ?? 0;
  // The move has to help the club, not just his number: he upgrades the spot
  // he moves to, and doesn't leave a hole where he was.
  const options = reads
    .filter((r) => r.pos !== p.pos && r.pos !== 'DH' && r.fit !== 'Not a fit' && r.fit !== 'Stretch')
    // Moving up the defensive spectrum is for young players the scouts are sure about.
    .filter((r) => SPECTRUM.indexOf(r.pos) <= SPECTRUM.indexOf(p.pos) || ((r.fit === 'Natural' || r.fit === 'Good fit') && league.season - p.born <= 26))
    .map((r) => {
      const gain = r.projected - cur.now;
      if (p.level === 'MLB') {
        const upgrade = r.projected - bestAt(r.pos);
        const leftBehind = bestAt(p.pos) >= cur.now - 3;
        if (upgrade < 2.5 || !leftBehind) return null;
        if (r.fit === 'Can handle it' && gain < 3) return null;
        return { pos: r.pos, gain: Math.min(gain + upgrade * 0.5, upgrade + 2), projected: r.projected };
      }
      // In the minors it's about his path: a better future at the new spot.
      return gain >= 3 ? { pos: r.pos, gain, projected: r.projected } : null;
    })
    .filter((x): x is { pos: Pos; gain: number; projected: number } => !!x && x.gain >= 1.5)
    .sort((a, b) => b.gain - a.gain);
  return options[0] ?? null;
}

// AI clubs make moves when their scouts see value (more often in the winter).
export function aiPositionMoves(league: League): void {
  const winter = league.phase === 'preseason';
  if (!winter && !(league.phase === 'regular' && league.day % 30 === 0)) return;
  if (winter && league.day % 10 !== 0) return;
  for (const org of league.orgs) {
    if (org.id === league.userOrgId) continue;
    // Most checks a club does nothing; when it acts, it makes its best move.
    if (rand() > (winter ? 0.15 : 0.08)) continue;
    const pool = shuffle(orgPlayers(league, org.id).filter((p) => (p.level === 'MLB' || p.level === 'AAA' || p.level === 'AA') && !p.il));
    const best = pool.map((p) => ({ p, m: bestMove(league, org, p) })).filter((x) => x.m).sort((a, b) => b.m!.gain - a.m!.gain)[0];
    if (best) changePosition(league, best.p, best.m!.pos, 'club decision');
  }
}

// A move that fixes your MLB roster, or null. Position players: only when he's
// blocked at his spot by a clearly better teammate who plays it (say, a center
// fielder you just acquired) and he'd be an upgrade where he goes. Pitchers: a
// starter outside your top five who'd help the bullpen, or a reliever who'd beat
// your fifth starter.
function rosterMove(league: League, org: Org, p: Player): { pos: Pos; text: string; gain: number } | null {
  if (p.level !== 'MLB' || p.il || p.injury) return null;
  const mlb = activeAt(league, org.id, 'MLB').filter((x) => x.id !== p.id && !x.injury);
  if (isPitcher(p)) {
    const pr = p.ratings.pit;
    const asSp = pitcherOvr(pr.stuff, pr.movement, pr.control, pr.stamina, 'SP');
    const asRp = pitcherOvr(pr.stuff, pr.movement, pr.control, pr.stamina, 'RP');
    const sps = mlb.filter((x) => x.pos === 'SP').map(ovr).sort((a, b) => b - a);
    const rps = mlb.filter((x) => x.pos === 'RP').map(ovr).sort((a, b) => b - a);
    if (p.pos === 'SP' && sps.length >= 5 && ovr(p) < sps[4] && rps.length && asRp >= rps[Math.min(rps.length - 1, 6)] + 3)
      return { pos: 'RP', gain: asRp - rps[Math.min(rps.length - 1, 6)], text: `${pname(p)} is our sixth starter right now. In the bullpen his stuff would play up and he'd be one of our better relievers.` };
    if (p.pos === 'RP' && pr.stamina >= 45 && sps.length >= 4 && asSp >= (sps[4] ?? sps[sps.length - 1]) + 2)
      return { pos: 'SP', gain: asSp - (sps[4] ?? sps[sps.length - 1]), text: `${pname(p)} would be better than our current fifth starter. He has the arsenal and the arm; we'd stretch him out gradually.` };
    return null;
  }
  if (p.pos === 'DH') return null;
  const here = fieldValue(p, p.pos);
  const blocker = mlb.filter((x) => x.pos === p.pos).sort((a, b) => fieldValue(b, p.pos) - fieldValue(a, p.pos))[0];
  if (!blocker || fieldValue(blocker, p.pos) < here + 2) return null;
  const bestAt = (pos: Pos) => mlb.filter((x) => x.pos === pos).map((x) => fieldValue(x, pos)).sort((a, b) => b - a)[0] ?? 0;
  const dest = positionReads(league, org, p)
    .filter((r) => r.pos !== p.pos && r.pos !== 'DH' && (r.fit === 'Natural' || r.fit === 'Good fit' || r.fit === 'Can handle it'))
    .map((r) => ({ r, upgrade: r.projected + (DEF_EXTRA[r.pos] ?? 0) * (defAt(p, r.pos as FieldPos) - 50) - bestAt(r.pos) }))
    .filter((x) => x.upgrade >= 2.5)
    .sort((a, b) => b.upgrade - a.upgrade)[0];
  if (!dest) return null;
  const incumbent = mlb.filter((x) => x.pos === dest.r.pos).sort((a, b) => fieldValue(b, dest.r.pos) - fieldValue(a, dest.r.pos))[0];
  return {
    pos: dest.r.pos,
    gain: dest.upgrade,
    text: `With ${pname(blocker)} at ${p.pos}, ${pname(p)} could slide over to ${dest.r.pos}${incumbent ? `, where he'd be an upgrade over ${pname(incumbent)}` : ', where we have an opening'}. Our staff calls him "${dest.r.fit.toLowerCase()}" there; it may take time for him to settle in.`,
  };
}

// Your farm director suggests a move only when it fixes your MLB roster (you
// accept or decline). Checked daily, so a trade that creates the need prompts it.
export function suggestPositionMoves(league: League): void {
  if (league.phase !== 'preseason' && league.phase !== 'regular') return;
  const org = league.orgs[league.userOrgId];
  const mine = (league.inbox ?? []).filter((m) => m.kind === 'position' && m.season === league.season);
  // One idea at a time, three weeks apart, unless a trade or signing just changed the roster.
  if (mine.some((m) => !m.resolved)) return;
  const last = mine[mine.length - 1];
  const rosterChanged = league.transactions.some((t) => t.orgId === org.id && t.season === league.season && t.day >= league.day - 2 && /^(Acquired|Traded|Signed|Claimed)/.test(t.text));
  if (last && league.day - last.day < 21 && !rosterChanged) return;
  const asked = new Set(mine.map((m) => m.pids[0]));
  const ideas = orgPlayers(league, org.id)
    .filter((p) => !asked.has(p.id) && p.level === 'MLB')
    .map((p) => ({ p, m: rosterMove(league, org, p) }))
    .filter((x) => x.m)
    .sort((a, b) => b.m!.gain - a.m!.gain)
    .slice(0, 1);
  for (const { p, m } of ideas) {
    const text = m!.text;
    addInbox(league, {
      from: 'Farm director', subject: `Position idea: ${pname(p)} to ${m!.pos}`, kind: 'position', pids: [p.id], text,
      actions: [{ key: `move-${m!.pos}`, label: `Move him to ${m!.pos}` }, { key: 'keep', label: `Keep him at ${p.pos}` }],
    });
  }
}

export function answerPosition(league: League, pid: number, key: string): string {
  const p = league.players[pid];
  if (!p || !key.startsWith('move-')) return 'He stays put.';
  return changePosition(league, p, key.slice(5) as Pos, 'farm director suggestion');
}

// ---------- September call-ups ----------

// On September 1, your farm director suggests two call-ups for the expanded roster.
export function septemberCallups(league: League): void {
  if (league.phase !== 'regular' || league.day !== league.settings.septemberDay) return;
  const org = league.orgs[league.userOrgId];
  const cands = orgPlayers(league, org.id)
    .filter((p) => p.on40 && p.level !== 'MLB' && !p.injury && !p.il)
    .sort((a, b) => ovr(b) + (b.mlServiceDays < 45 ? 2 : 0) - (ovr(a) + (a.mlServiceDays < 45 ? 2 : 0)))
    .slice(0, 2);
  if (!cands.length) return;
  addInbox(league, {
    from: 'Farm director', subject: 'September call-ups', kind: 'september', pids: cands.map((p) => p.id),
    text: `Rosters expand to ${league.settings.activeMaxSept} today. I'd bring up ${cands.map((p) => `${p.pos} ${pname(p)} (${p.level})`).join(' and ')}: they've earned a look and it's a chance to see them against big leaguers.`,
    actions: [{ key: 'callup', label: 'Call them up' }, { key: 'pass', label: 'Not this year' }],
  });
}

export function answerSeptember(league: League, pids: number[], key: string, recall: (p: Player) => string | null): string {
  if (key !== 'callup') return 'No September call-ups.';
  const done: string[] = [];
  for (const id of pids) {
    const p = league.players[id];
    if (!p) continue;
    const why = recall(p);
    if (!why) done.push(pname(p));
  }
  return done.length ? `Called up ${done.join(' and ')}.` : 'No room on the active roster.';
}

// A young minor league reliever who has built a starter's stamina (and has the
// pitches for it) moves to the rotation. Runs monthly.
export function stretchOutProspects(league: League): void {
  for (const p of Object.values(league.players)) {
    if (p.orgId === null || p.pos !== 'RP' || !p.level || p.level === 'MLB' || p.il) continue;
    if (league.season - p.born > 25 || p.ratings.pit.stamina < 45 || canStart(p)) continue;
    changePosition(league, p, 'SP', 'built up a starter\'s stamina');
    if (p.orgId === league.userOrgId) {
      addInbox(league, { from: 'Farm Director', subject: `${pname(p)} moves to the rotation`, kind: 'info', pids: [p.id], text: `${pname(p)} (${p.level}) has built up a starter's stamina and has the pitches for it, so we've moved him to the rotation. He'll be stretched out over his next few starts. You can move him back on his player page.` });
    }
  }
}

// ---------- games played by position ----------

const FLD_ORDER = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];
export interface PosGames { pos: string; g: number; gs: number }

// Games and starts at each position he has played (most games first), for a
// season (or all seasons) at a level (or all levels). Only positions played.
export function positionGames(p: Player, season?: number, level: Level | 'all' = 'MLB'): PosGames[] {
  const acc = new Map<string, PosGames>();
  for (const e of p.stats) {
    if (season !== undefined && e.season !== season) continue;
    if (level !== 'all' && e.level !== level) continue;
    for (const [pos, [g, gs]] of Object.entries(e.fld ?? {})) {
      const r = acc.get(pos) ?? { pos, g: 0, gs: 0 };
      r.g += g;
      r.gs += gs;
      acc.set(pos, r);
    }
  }
  return [...acc.values()].filter((r) => r.g > 0).sort((a, b) => b.g - a.g || FLD_ORDER.indexOf(a.pos) - FLD_ORDER.indexOf(b.pos));
}

export const posGamesText = (rows: PosGames[], max = 3) => rows.slice(0, max).map((r) => `${r.pos} ${r.g}`).join(', ') + (rows.length > max ? ` +${rows.length - max}` : '');
export const FIELD_ORDER = FLD_ORDER;

// The season whose games-by-position to show: last season's during spring
// training (no games played yet), otherwise this season's.
export const playedSeason = (league: League): number => (league.phase === 'preseason' ? league.season - 1 : league.season);
