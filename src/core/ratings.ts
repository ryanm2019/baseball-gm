// Derived ratings: contact, position ratings, overall/potential, and the
// scouted (noisy) values the user actually sees.
import type { BatSplit, DefRatings, FieldPos, League, Level, Org, Player, Pos, StaffRole } from './types.ts';
import { clamp, seededNormal } from './random.ts';
import { deptEffect } from './depts.ts';

export const contact = (s: BatSplit): number => (s.babip + s.avoidK) / 2;

export function offense(s: BatSplit): number {
  return 0.24 * s.babip + 0.2 * s.avoidK + 0.26 * s.power + 0.18 * s.eye + 0.12 * s.gap;
}

export function blendSplits(p: Player): BatSplit {
  const { vL, vR } = p.ratings;
  const w = 0.7; // most plate appearances come against right-handers
  return {
    babip: w * vR.babip + (1 - w) * vL.babip,
    avoidK: w * vR.avoidK + (1 - w) * vL.avoidK,
    gap: w * vR.gap + (1 - w) * vL.gap,
    power: w * vR.power + (1 - w) * vL.power,
    eye: w * vR.eye + (1 - w) * vL.eye,
  };
}

const POS_OFFSET: Record<FieldPos, number> = { C: 0, '1B': 12, '2B': 5, '3B': 3, SS: 0, LF: 8, CF: 0, RF: 4 };

export function posRating(d: DefRatings, pos: FieldPos): number {
  let r: number;
  switch (pos) {
    case 'C':
      r = 0.6 * d.cAbil + 0.4 * d.cArm;
      break;
    case '1B':
      r = 0.45 * d.ifErr + 0.4 * d.ifRange + 0.15 * d.ifArm;
      break;
    case '2B':
      r = 0.45 * d.ifRange + 0.25 * d.tdp + 0.2 * d.ifErr + 0.1 * d.ifArm;
      break;
    case '3B':
      r = 0.4 * d.ifArm + 0.3 * d.ifRange + 0.25 * d.ifErr + 0.05 * d.tdp;
      break;
    case 'SS':
      r = 0.45 * d.ifRange + 0.25 * d.ifArm + 0.15 * d.tdp + 0.15 * d.ifErr;
      break;
    case 'LF':
      r = 0.6 * d.ofRange + 0.25 * d.ofErr + 0.15 * d.ofArm;
      break;
    case 'CF':
      r = 0.7 * d.ofRange + 0.15 * d.ofErr + 0.15 * d.ofArm;
      break;
    case 'RF':
      r = 0.5 * d.ofRange + 0.2 * d.ofErr + 0.3 * d.ofArm;
      break;
  }
  return r + POS_OFFSET[pos];
}

const POS_ADJ: Record<string, number> = { C: 4, SS: 4, CF: 3, '2B': 2, '3B': 1, RF: 0, LF: -2, '1B': -4, DH: -7 };

export const isPitcher = (p: Player): boolean => p.pos === 'SP' || p.pos === 'RP';

export function hitterOvrAt(off: number, def: number, speed: number, pos: Pos): number {
  const d = pos === 'DH' ? 50 : def;
  return 50 + 0.85 * (off - 50) + 0.35 * (d - 50) + 0.06 * (speed - 50) + (POS_ADJ[pos] ?? 0);
}

export function pitcherOvr(stuff: number, movement: number, control: number, stamina: number, role: Pos): number {
  if (role === 'SP') {
    return 50 + 0.45 * (stuff - 50) + 0.32 * (control - 50) + 0.32 * (movement - 50) + 0.1 * (stamina - 55);
  }
  return 47 + 0.5 * (stuff - 50) + 0.3 * (control - 50) + 0.3 * (movement - 50);
}

export function ovr(p: Player): number {
  if (isPitcher(p)) {
    const r = p.ratings.pit;
    return pitcherOvr(r.stuff, r.movement, r.control, r.stamina, p.pos);
  }
  const pos = p.pos as FieldPos | 'DH';
  const def = pos === 'DH' ? 50 : defAt(p, pos);
  return hitterOvrAt(offense(blendSplits(p)), def, p.ratings.run.speed, pos);
}

export function potOvr(p: Player): number {
  const cur = ovr(p);
  let pot: number;
  if (isPitcher(p)) {
    pot = pitcherOvr(p.pot.stuff, p.pot.movement, p.pot.control, p.pot.stamina, p.pos);
  } else {
    const pos = p.pos as FieldPos | 'DH';
    const def = pos === 'DH' ? 50 : posRating(p.pot.def, pos) + Math.max(0, defShift(p, pos));
    pot = hitterOvrAt(offense(p.pot.bat), def, p.pot.speed, pos);
  }
  return Math.max(cur, pot);
}

// ---------- playing a new position ----------
//
// Each player has a hidden aptitude for every position (how his skills
// translate there once he's settled in), a pace of adapting, and a limit: some
// never fully get comfortable. A new position starts with a penalty that
// fades with experience. His home position (where he came up) is rated as is.
export const FIELD_POSITIONS: FieldPos[] = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];
const LEARN: Record<FieldPos, number> = { C: 16, '1B': 4, '2B': 7, '3B': 6, SS: 10, LF: 4, CF: 8, RF: 4 };

const homeOf = (p: Player): Pos => p.posInfo?.home ?? p.pos;

// Experience he already has from nearby positions.
function familiar(home: Pos, pos: FieldPos): number {
  const of = ['LF', 'CF', 'RF'];
  if (home === pos) return 100;
  if (of.includes(home) && of.includes(pos)) return home === 'CF' ? 75 : pos === 'CF' ? 20 : 65;
  if (home === 'SS' && (pos === '2B' || pos === '3B')) return 55;
  if ((home === '2B' || home === '3B') && pos !== 'C' && ['SS', '2B', '3B'].includes(pos)) return 25;
  if (pos === '1B') return home === 'C' ? 30 : ['2B', '3B', 'SS'].includes(home) ? 45 : of.includes(home) ? 20 : 0;
  return 0;
}

export function posExp(p: Player, pos: FieldPos): number {
  return clamp(p.posInfo?.exp[pos] ?? familiar(homeOf(p), pos), 0, 100);
}

// Hidden: rating points at the position once fully settled in.
export const aptitude = (p: Player, pos: FieldPos): number => clamp(seededNormal(p.scoutSeed, FIELD_POSITIONS.indexOf(pos), 7777) * 5, -11, 9);
// Hidden: how far he can adapt (a few never get past halfway).
export function adaptCap(p: Player, pos: FieldPos): number {
  const s = seededNormal(p.scoutSeed, FIELD_POSITIONS.indexOf(pos), 7778);
  return s < -1.15 ? 0.45 : s < -0.6 ? 0.75 : 1;
}
// Hidden: how quickly (younger, harder-working players learn faster).
export function adaptSpeed(league: League | null, p: Player, pos: FieldPos): number {
  const s = clamp(1 + 0.4 * seededNormal(p.scoutSeed, FIELD_POSITIONS.indexOf(pos), 7779), 0.4, 1.9);
  const age = league ? league.season - p.born : 27;
  return s * (age >= 31 ? 0.7 : age <= 24 ? 1.15 : 1) * (0.8 + p.personality.workEthic / 250);
}

// Effective defense at a position: raw skills, adjusted for how settled he is.
export function defShift(p: Player, pos: FieldPos): number {
  if (homeOf(p) === pos) return 0;
  const e = Math.min(posExp(p, pos) / 100, adaptCap(p, pos));
  return aptitude(p, pos) * e - LEARN[pos] * (1 - e);
}
export const defAt = (p: Player, pos: FieldPos): number => posRating(p.ratings.def, pos) + defShift(p, pos);

// Best defensive position rating among positions a player can handle.
export function bestPositions(p: Player): { pos: FieldPos; rating: number }[] {
  const out: { pos: FieldPos; rating: number }[] = [];
  for (const pos of ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'] as FieldPos[]) {
    out.push({ pos, rating: posRating(p.ratings.def, pos) });
  }
  return out.sort((a, b) => b.rating - a.rating);
}

// ---------- Scouting ----------

const ACCURACY_SD = { Perfect: 0, High: 2, Normal: 4, Low: 7 };
const LEVEL_FOG: Record<Level, number> = { MLB: 0.6, AAA: 0.8, AA: 1, 'A+': 1.15, A: 1.3, CPX: 1.5, DSL: 1.7 };

function keyHash(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
  return h;
}

// Relative noise of a club's scouting in one area (1 = an average department).
// The scouting director sharpens everything; each area scout covers his own
// players: pro (MLB, minors, free agents), amateur (draft) and international.
export type ScoutArea = 'own' | 'pro' | 'amateur' | 'intl';
const AREA_ROLE: Record<Exclude<ScoutArea, 'own'>, StaffRole> = { pro: 'PRO', amateur: 'AMA', intl: 'INT' };
const evalScale = (v: number, lo: number, hi: number) => lo + ((clamp(v, 20, 80) - 20) / 60) * (hi - lo);

function staffEval(league: League, org: Org, role: StaffRole): number | null {
  const id = org.staff[role];
  if (id === undefined) return null;
  const s = league.staff.find((x) => x.id === id);
  return s ? s.evaluation : null;
}

// Scouting assignments: what each scout is focused on (see ScoutFocus).
export function focusMatches(f: string | undefined, p: Player): boolean {
  if (!f || f === 'general') return false;
  if (f === 'HS' || f === 'College') return !!p.prospect && (f === 'HS' ? !p.prospect.college : p.prospect.college);
  if (f.startsWith('country:')) return p.country === f.slice(8);
  if (f.startsWith('org:')) return p.orgId === Number(f.slice(4));
  return false;
}

export function scoutFactor(league: League, org: Org, area: ScoutArea, p?: Player): number {
  const dir = staffEval(league, org, 'SD');
  const d = dir === null ? 1.25 : evalScale(dir, 1.2, 0.8);
  const budget = 1 - 0.2 * deptEffect(org, 'scouting'); // scouting department spending
  if (area === 'own') return 0.7 * d * budget; // coaches and the farm staff see your own players every day
  const sc = staffEval(league, org, AREA_ROLE[area]);
  // A scout assigned to a focus sees it sharply and the rest of his beat a bit less;
  // the director's own focus helps on top.
  const f = org.scoutFocus?.[AREA_ROLE[area]];
  const focus = p ? (focusMatches(f, p) ? 0.72 : f && f !== 'general' ? 1.08 : 1) * (focusMatches(org.scoutFocus?.SD, p) ? 0.85 : 1) : 1;
  return (sc === null ? 1.7 : evalScale(sc, 1.45, 0.55)) * d * budget * focus;
}

export function scoutArea(league: League, p: Player): ScoutArea {
  if (p.prospect && p.orgId === null) return 'amateur';
  if (p.ifa && p.orgId === null) return 'intl';
  return p.orgId === league.userOrgId ? 'own' : 'pro';
}

export function scoutSd(league: League, p: Player, isPot: boolean): number {
  const base = ACCURACY_SD[league.settings.scoutingAccuracy];
  if (base === 0) return 0;
  const area = scoutArea(league, p);
  // High school amateurs are the hardest to project.
  const lvl = area === 'amateur' ? (p.prospect && !p.prospect.college ? 1.9 : 1.35) : area === 'intl' ? 1.6 : LEVEL_FOG[p.level ?? 'AAA'];
  return base * lvl * scoutFactor(league, league.orgs[league.userOrgId], area, p) * (isPot ? 1.6 : 1);
}

export function scoutRaw(league: League, p: Player, key: string, value: number, isPot = false): number {
  const sd = scoutSd(league, p, isPot);
  if (sd === 0) return value;
  return value + sd * seededNormal(p.scoutSeed, league.season, keyHash(key));
}

export function grade(league: League, value: number): number {
  const inc = league.settings.ratingIncrement;
  return clamp(Math.round(value / inc) * inc, 20, 80);
}

export function scout(league: League, p: Player, key: string, value: number, isPot = false): number {
  return grade(league, scoutRaw(league, p, key, value, isPot));
}

// Relievers throw a fraction of a starter's innings, so the overall you see is
// scaled to their value: an elite closer reads about 60-65, not 70.
export const displayOvr = (p: Player, x: number): number => (p.pos === 'RP' ? 50 + 0.65 * (x - 50) : x);

export function scoutedOvr(league: League, p: Player): number {
  return grade(league, displayOvr(p, scoutRaw(league, p, 'ovr', ovr(p))));
}

export function scoutedPot(league: League, p: Player): number {
  const cur = scoutRaw(league, p, 'ovr', ovr(p));
  const pot = scoutRaw(league, p, 'pot', potOvr(p), true);
  return grade(league, displayOvr(p, Math.max(cur, pot)));
}

// Exact (unrounded, still noisy) values used by AI decision making for the user's org,
// so the farm director only knows what scouting tells him.
export function perceivedOvr(league: League, p: Player, evalSd: number): number {
  return ovr(p) + evalSd * seededNormal(p.scoutSeed, league.season, 777);
}
