// Random player generation on the 20-80 scale.
import type { BatSplit, DefRatings, FieldPos, Hand, Level, PitchType, Player, Pos } from './types.ts';
import { clamp, normal, rand, randInt, weightedChoice } from './random.ts';
import { randomOrigin } from './names.ts';
import { LEVEL_AGE, LEVEL_TALENT } from './settings.ts';
import { isPitcher, ovr } from './ratings.ts';

const HITTER_POS: Pos[] = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];
const HITTER_W = [8, 5, 6, 6, 7, 5, 6, 6, 1.5];

const OFF_SHIFT: Record<string, number> = { C: -3, '1B': 4, '2B': -1, '3B': 1, SS: -2, LF: 2, CF: -1, RF: 2, DH: 5 };

// Mean defensive components for a typical MLB player at each primary position.
const DEF_MEANS: Record<string, Partial<DefRatings>> = {
  C: { cAbil: 50, cArm: 50, ifRange: 30, ifErr: 38, ifArm: 45, tdp: 30, ofRange: 25, ofErr: 35, ofArm: 40 },
  '1B': { ifRange: 37, ifErr: 40, ifArm: 40, tdp: 35, ofRange: 30, ofErr: 38, ofArm: 38 },
  '2B': { ifRange: 47, ifErr: 48, ifArm: 42, tdp: 52, ofRange: 40, ofErr: 42, ofArm: 40 },
  '3B': { ifRange: 44, ifErr: 47, ifArm: 55, tdp: 42, ofRange: 35, ofErr: 40, ofArm: 50 },
  SS: { ifRange: 52, ifErr: 50, ifArm: 52, tdp: 50, ofRange: 45, ofErr: 44, ofArm: 50 },
  LF: { ifRange: 30, ifErr: 35, ifArm: 38, tdp: 28, ofRange: 42, ofErr: 45, ofArm: 42 },
  CF: { ifRange: 35, ifErr: 38, ifArm: 42, tdp: 30, ofRange: 52, ofErr: 50, ofArm: 48 },
  RF: { ifRange: 32, ifErr: 36, ifArm: 45, tdp: 28, ofRange: 46, ofErr: 47, ofArm: 54 },
  DH: { ifRange: 30, ifErr: 34, ifArm: 36, tdp: 28, ofRange: 30, ofErr: 34, ofArm: 36 },
};

const SPEED_MEAN: Record<string, number> = { C: 30, '1B': 35, '2B': 50, '3B': 42, SS: 54, LF: 47, CF: 58, RF: 47, DH: 33 };

const AGE_RANGE: Record<Level, [number, number]> = {
  MLB: [21, 40],
  AAA: [21, 35],
  AA: [19, 30],
  'A+': [19, 27],
  A: [18, 25],
  CPX: [17, 23],
  DSL: [16, 20],
};

const AGE_SD: Record<Level, number> = { MLB: 3.6, AAA: 2.6, AA: 1.8, 'A+': 1.4, A: 1.3, CPX: 1.2, DSL: 0.9 };

const r20 = (x: number) => clamp(x, 15, 85);

export interface GenOptions {
  id: number;
  season: number;
  level: Level;
  orgId: number | null;
  pos?: Pos;
  age?: number;
  talentShift?: number;
  international?: boolean;
}

export function randomPos(): Pos {
  if (rand() < 0.5) return rand() < 0.42 ? 'SP' : 'RP';
  return weightedChoice(HITTER_POS, HITTER_W);
}

function growthFor(age: number, level: Level): number {
  // Expected remaining growth (pot - current) in overall points.
  const years = Math.max(0, 27 - age);
  const youngForLevel = Math.max(0, LEVEL_AGE[level] - age);
  const base = years * 1.9 + youngForLevel * 1.4;
  return Math.max(0, base * (0.35 + rand() * 1.15) + normal(0, 1.5));
}

function makeSplit(base: number, pos: Pos, archetype: string): BatSplit {
  const shift = OFF_SHIFT[pos] ?? 0;
  const s: BatSplit = {
    babip: base + shift + normal(0, 6),
    avoidK: base + shift + normal(0, 7),
    gap: base + shift + normal(0, 7),
    power: base + shift + normal(0, 8),
    eye: base + shift + normal(0, 7),
  };
  if (archetype === 'power') {
    s.power += 7;
    s.avoidK -= 6;
    s.babip -= 2;
  } else if (archetype === 'contact') {
    s.avoidK += 8;
    s.babip += 3;
    s.power -= 7;
  } else if (archetype === 'patient') {
    s.eye += 8;
    s.avoidK -= 2;
  } else if (archetype === 'free') {
    s.eye -= 7;
    s.avoidK += 2;
    s.babip += 2;
  }
  return s;
}

function platoon(base: BatSplit, bats: Hand): { vL: BatSplit; vR: BatSplit } {
  const dL = bats === 'R' ? 2 : bats === 'L' ? -5 : 0;
  const dR = bats === 'R' ? -1 : bats === 'L' ? 1.5 : 0;
  const app = (d: number): BatSplit => ({
    babip: base.babip + d * 0.6 + normal(0, 1.5),
    avoidK: base.avoidK + d + normal(0, 1.5),
    gap: base.gap + d * 0.5 + normal(0, 1.5),
    power: base.power + d + normal(0, 1.5),
    eye: base.eye + d * 0.4 + normal(0, 1.5),
  });
  return { vL: app(dL), vR: app(dR) };
}

function makeDef(pos: Pos, talent: number): DefRatings {
  const m = DEF_MEANS[pos] ?? DEF_MEANS.DH;
  const t = (talent - 50) * 0.35;
  const g = (v: number | undefined, sd = 6) => (v === undefined ? 20 + Math.abs(normal(0, 4)) : v + t + normal(0, sd));
  return {
    cAbil: pos === 'C' ? g(m.cAbil) : 20 + Math.abs(normal(0, 3)),
    cArm: pos === 'C' ? g(m.cArm) : 22 + Math.abs(normal(0, 5)),
    ifRange: g(m.ifRange),
    ifErr: g(m.ifErr),
    ifArm: g(m.ifArm),
    tdp: g(m.tdp),
    ofRange: g(m.ofRange),
    ofErr: g(m.ofErr),
    ofArm: g(m.ofArm),
  };
}

const PITCH_POOL: PitchType[] = ['SL', 'CB', 'CH', 'SW', 'CT', 'SP', 'SI'];

function makePitches(stuff: number, starter: boolean): Partial<Record<PitchType, number>> {
  const out: Partial<Record<PitchType, number>> = {};
  out[rand() < 0.75 ? 'FB' : 'SI'] = stuff + normal(0, 5);
  const n = starter ? randInt(2, 4) : randInt(1, 2);
  const pool = PITCH_POOL.filter((p) => !(p in out));
  for (let i = 0; i < n && pool.length; i++) {
    const idx = Math.floor(rand() * pool.length);
    const pt = pool.splice(idx, 1)[0];
    out[pt] = stuff + normal(i === 0 ? 2 : -2, 6);
  }
  if (rand() < 0.003) out.KN = 60;
  return out;
}

export function generatePlayer(o: GenOptions): Player {
  const level = o.level;
  const pos = o.pos ?? randomPos();
  const [amin, amax] = AGE_RANGE[level];
  const age = o.age ?? Math.round(clamp(normal(LEVEL_AGE[level], AGE_SD[level]), amin, amax));
  const intl = o.international ?? (level === 'DSL' ? true : rand() < 0.28);
  const origin = randomOrigin(intl);

  const talent = LEVEL_TALENT[level] + (o.talentShift ?? 0) + normal(0, level === 'MLB' ? 6.5 : 5.5);
  const growth = level === 'MLB' && age >= 27 ? Math.max(0, normal(0.3, 0.8)) : growthFor(age, level);

  const pitcher = pos === 'SP' || pos === 'RP';
  const throws: 'L' | 'R' = pitcher
    ? rand() < 0.28 ? 'L' : 'R'
    : ['C', '2B', '3B', 'SS'].includes(pos) ? 'R' : rand() < 0.22 ? 'L' : 'R';
  let bats: Hand;
  if (pitcher) bats = throws === 'L' ? 'L' : rand() < 0.9 ? 'R' : 'L';
  else {
    const r = rand();
    bats = throws === 'L' ? (r < 0.85 ? 'L' : 'S') : r < 0.62 ? 'R' : r < 0.9 ? 'L' : 'S';
  }

  const archetype = weightedChoice(['balanced', 'power', 'contact', 'patient', 'free'], [4, 2, 2, 1, 1]);
  const batBase = pitcher ? 22 : talent;
  const base = makeSplit(batBase, pitcher ? 'DH' : pos, pitcher ? 'balanced' : archetype);
  const { vL, vR } = platoon(base, bats);
  const def = makeDef(pitcher ? 'DH' : pos, pitcher ? 35 : talent);
  if (pitcher) {
    def.ifRange = 35 + normal(0, 6);
    def.ifErr = 40 + normal(0, 6);
  }
  const speed = pitcher ? 30 + normal(0, 6) : (SPEED_MEAN[pos] ?? 45) + (talent - 50) * 0.15 + normal(0, 9) - Math.max(0, age - 28) * 1.2;
  const steal = speed + normal(0, 7);
  const baserunning = speed * 0.55 + 22 + normal(0, 7);

  const starter = pos === 'SP';
  const parch = weightedChoice(['balanced', 'power', 'finesse', 'sinker'], [4, 2, 2, 1]);
  let stuff = talent + normal(0, 6);
  let movement = talent + normal(0, 6);
  let control = talent + normal(0, 7);
  let gb = 50 + normal(0, 9);
  if (parch === 'power') {
    stuff += 6;
    control -= 5;
  } else if (parch === 'finesse') {
    control += 7;
    stuff -= 6;
  } else if (parch === 'sinker') {
    gb += 14;
    movement += 4;
    stuff -= 3;
  }
  const stamina = starter ? clamp(normal(63, 7), 45, 80) : clamp(normal(31, 6), 20, 44);
  const velo = 92.5 + (stuff - 50) * 0.13 + (starter ? 0 : 1.2) + normal(0, 1.4) - (throws === 'L' ? 1.2 : 0);

  const p: Player = {
    id: o.id,
    first: origin.first,
    last: origin.last,
    born: o.season - age,
    country: origin.country,
    bats,
    throws,
    pos,
    height: Math.round(clamp(normal(pitcher ? 74.5 : 72.5, 2.2), 66, 81)),
    weight: 0,
    ratings: {
      vL,
      vR,
      run: { speed, steal, baserunning },
      def,
      pit: {
        stuff: pitcher ? stuff : 20,
        movement: pitcher ? movement : 20,
        control: pitcher ? control : 20,
        stamina: pitcher ? stamina : 20,
        gb: pitcher ? gb : 50,
        velo: pitcher ? Math.round(velo * 10) / 10 : 0,
        pitches: pitcher ? makePitches(stuff, starter) : {},
      },
    },
    pot: {
      bat: { ...base },
      stuff,
      movement,
      control,
      stamina,
      speed,
      def: { ...def },
    },
    personality: {
      workEthic: clamp(normal(50, 13), 20, 80),
      intelligence: clamp(normal(50, 13), 20, 80),
      leadership: clamp(normal(50, 13), 20, 80),
      loyalty: clamp(normal(50, 13), 20, 80),
      greed: clamp(normal(50, 13), 20, 80),
      winning: clamp(normal(50, 13), 20, 80),
    },
    injuryProne: clamp(Math.exp(normal(0, 0.35)), 0.45, 2.5),
    scoutSeed: Math.floor(rand() * 2 ** 31),
    orgId: o.orgId,
    level,
    on40: false,
    contract: { type: 'MiLB', salary: 0, minorSalary: 0, exp: o.season, oneWay: false, signed: o.season },
    il: null,
    injury: null,
    dfa: null,
    waivers: null,
    optionsUsed: 0,
    optionDaysThisSeason: 0,
    optionsThisSeason: 0,
    optionedOnDay: null,
    mlServiceDays: 0,
    serviceThisSeason: 0,
    proSeasons: Math.max(0, age - (intl ? 16 : 21)),
    outrightedBefore: false,
    draft: null,
    lastPitchedDay: -99,
    lastPitchCount: 0,
    consecutiveDays: 0,
    lastStartDay: -99,
    stats: [],
  };
  p.weight = Math.round(clamp(normal(150 + (p.height - 66) * 5.5, 12), 160, 280));

  // Nudge components so the generated overall lands on the talent target.
  const delta = talent - ovr(p);
  if (isPitcher(p)) {
    const s = delta / 1.09;
    p.ratings.pit.stuff += s;
    p.ratings.pit.movement += s;
    p.ratings.pit.control += s;
  } else {
    const s = delta / 1.2;
    for (const split of [p.ratings.vL, p.ratings.vR]) {
      split.babip += s;
      split.avoidK += s;
      split.gap += s;
      split.power += s;
      split.eye += s;
    }
    for (const k of Object.keys(p.ratings.def) as (keyof DefRatings)[]) {
      if ((k === 'cAbil' || k === 'cArm') && pos !== 'C') continue;
      p.ratings.def[k] += s;
    }
  }

  // Potentials: current + growth spread unevenly across tools.
  const g = () => growth * (0.55 + rand() * 0.9);
  const blendBase = (k: keyof BatSplit) => 0.7 * p.ratings.vR[k] + 0.3 * p.ratings.vL[k];
  p.pot.bat = {
    babip: r20(blendBase('babip') + g()),
    avoidK: r20(blendBase('avoidK') + g()),
    gap: r20(blendBase('gap') + g()),
    power: r20(blendBase('power') + g() * 1.1),
    eye: r20(blendBase('eye') + g()),
  };
  p.pot.stuff = r20(p.ratings.pit.stuff + g());
  p.pot.movement = r20(p.ratings.pit.movement + g());
  p.pot.control = r20(p.ratings.pit.control + g());
  p.pot.stamina = r20(p.ratings.pit.stamina + (pitcher ? growth * 0.3 * rand() : 0));
  p.pot.speed = r20(p.ratings.run.speed + (age < 21 ? rand() * 3 : 0));
  p.pot.def = { ...p.ratings.def };
  for (const k of Object.keys(p.pot.def) as (keyof DefRatings)[]) {
    if ((k === 'cAbil' || k === 'cArm') && pos !== 'C') continue;
    p.pot.def[k] = r20(p.ratings.def[k] + growth * 0.35 * rand());
  }
  return p;
}

export const fieldPositions = (p: Player): FieldPos[] =>
  p.pos === 'SP' || p.pos === 'RP' || p.pos === 'DH' ? [] : [p.pos];
