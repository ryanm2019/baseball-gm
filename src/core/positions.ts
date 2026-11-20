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
import type { FieldPos, League, Org, Player, Pos } from './types.ts';
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

// Your farm director suggests moves he believes in (you accept or decline).
export function suggestPositionMoves(league: League): void {
  if (!(league.phase === 'preseason' && league.day % 10 === 0) && !(league.phase === 'regular' && league.day % 21 === 0)) return;
  const org = league.orgs[league.userOrgId];
  const asked = new Set((league.inbox ?? []).filter((m) => m.kind === 'position' && m.season === league.season).map((m) => m.pids[0]));
  const ideas = orgPlayers(league, org.id)
    .filter((p) => !asked.has(p.id) && (p.level === 'MLB' || p.level === 'AAA' || p.level === 'AA'))
    .map((p) => ({ p, m: bestMove(league, org, p) }))
    .filter((x) => x.m)
    .sort((a, b) => b.m!.gain - a.m!.gain)
    .slice(0, 2);
  for (const { p, m } of ideas) {
    const pitch = isPitcher(p);
    const text = pitch
      ? m!.pos === 'RP'
        ? `${pname(p)} might be more valuable in the bullpen, where his stuff would play up in short stints.`
        : `${pname(p)} has the arsenal and the arm to start. We'd stretch him out gradually.`
      : `Our staff thinks ${pname(p)} could handle ${m!.pos}. It may take time for him to settle in, and there's no guarantee he does.`;
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
