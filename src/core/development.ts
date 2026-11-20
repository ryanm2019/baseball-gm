// In-season player development, run once a month. Young players move toward
// their potential; veterans decline. Work ethic, playing time and the
// organization's farm director all change the pace.
import type { BatSplit, DefRatings, League, Player } from './types.ts';
import { clamp, normal } from './random.ts';
import { isPitcher, ovr } from './ratings.ts';
import { devMultiplier } from './staff.ts';

function ageRate(a: number): number {
  if (a <= 20) return 0.042;
  if (a <= 23) return 0.034;
  if (a <= 26) return 0.024;
  if (a <= 29) return 0.01;
  return 0;
}

// Decline starts at 32 and accelerates gently; elite players (and hard
// workers) hold their skills longer.
function decline(a: number, p: Player): number {
  if (a < 32) return 0;
  const elite = ovr(p) >= 60 ? 0.75 : 1;
  const work = 1.1 - (0.2 * (p.personality.workEthic - 20)) / 60;
  return (a - 31) * 0.085 * elite * work;
}

export function developPlayer(league: League, p: Player): void {
  const a = league.season - p.born;
  const we = 0.7 + (0.6 * (p.personality.workEthic - 20)) / 60;
  const fdm = devMultiplier(league, p);
  const e = p.stats.find((s) => s.season === league.season && s.orgId === p.orgId && s.level === p.level);
  const playing = e && (e.bat.pa > 25 || e.pit.outs > 30) ? 1 : 0.6;
  const rate = ageRate(a) * we * fdm * playing;
  const dec = decline(a, p);
  const tcr = 0.45;

  const move = (cur: number, pot: number) => clamp(cur + Math.max(0, pot - cur) * rate + normal(0, tcr) - dec, 15, 85);

  const batKeys: (keyof BatSplit)[] = ['babip', 'avoidK', 'gap', 'power', 'eye'];
  if (!isPitcher(p)) {
    for (const k of batKeys) {
      const before = 0.7 * p.ratings.vR[k] + 0.3 * p.ratings.vL[k];
      const after = move(before, p.pot.bat[k]);
      const d = after - before;
      p.ratings.vR[k] += d;
      p.ratings.vL[k] += d;
      if (dec > 0) p.pot.bat[k] = Math.max(after, p.pot.bat[k] - dec);
    }
    const dkeys = Object.keys(p.ratings.def) as (keyof DefRatings)[];
    for (const k of dkeys) {
      if ((k === 'cAbil' || k === 'cArm') && p.pos !== 'C') continue;
      p.ratings.def[k] = move(p.ratings.def[k], p.pot.def[k]);
    }
  } else {
    const pit = p.ratings.pit;
    pit.stuff = move(pit.stuff, p.pot.stuff);
    pit.movement = move(pit.movement, p.pot.movement);
    pit.control = move(pit.control, p.pot.control);
    pit.stamina = clamp(pit.stamina + Math.max(0, p.pot.stamina - pit.stamina) * rate, 15, 85);
    if (dec > 0) {
      p.pot.stuff = Math.max(pit.stuff, p.pot.stuff - dec);
      p.pot.movement = Math.max(pit.movement, p.pot.movement - dec);
      p.pot.control = Math.max(pit.control, p.pot.control - dec);
    }
    pit.velo = Math.round((92.5 + (pit.stuff - 50) * 0.13 + (p.pos === 'RP' ? 1.2 : 0) - (p.throws === 'L' ? 1.2 : 0)) * 10) / 10;
  }
  // Speed peaks early.
  const speedDec = a >= 27 ? (a - 26) * 0.12 : 0;
  p.ratings.run.speed = clamp(p.ratings.run.speed - speedDec + normal(0, 0.2), 15, 85);
  p.ratings.run.steal = clamp(p.ratings.run.steal - speedDec, 15, 85);
}

export function monthlyDevelopment(league: League): void {
  for (const p of Object.values(league.players)) {
    if (p.orgId === null) continue;
    developPlayer(league, p);
  }
}

// Once a year, potential itself moves: some prospects break out, more of them
// stall. Keeps "potential" an estimate rather than a promise.
export function yearlyPotentialDrift(league: League, p: Player): void {
  const a = league.season - p.born;
  if (a > 27) return;
  const d = normal(-0.9, 2.6) + (p.personality.workEthic - 50) / 30;
  const bump = (cur: number, pot: number) => clamp(Math.max(cur, pot + d), 15, 85);
  if (isPitcher(p)) {
    p.pot.stuff = bump(p.ratings.pit.stuff, p.pot.stuff);
    p.pot.movement = bump(p.ratings.pit.movement, p.pot.movement);
    p.pot.control = bump(p.ratings.pit.control, p.pot.control);
  } else {
    const keys: (keyof BatSplit)[] = ['babip', 'avoidK', 'gap', 'power', 'eye'];
    for (const k of keys) p.pot.bat[k] = bump(0.7 * p.ratings.vR[k] + 0.3 * p.ratings.vL[k], p.pot.bat[k]);
  }
}

// Keeps the 20-80 scale anchored: average MLB player stays a 50. Shifts every
// rating (current and potential) halfway toward that target each winter.
export function recenterRatings(league: League): void {
  const mlb = Object.values(league.players).filter((p) => p.level === 'MLB' && p.orgId !== null);
  if (mlb.length < 100) return;
  const hit = mlb.filter((p) => !isPitcher(p));
  const pit = mlb.filter(isPitcher);
  const mean = (ps: Player[]) => ps.reduce((t, p) => t + ovr(p), 0) / Math.max(1, ps.length);
  const dh = (50 - mean(hit)) * 0.5;
  const dp = (50 - mean(pit)) * 0.5;
  for (const p of Object.values(league.players)) {
    if (p.retired) continue;
    if (isPitcher(p)) {
      for (const k of ['stuff', 'movement', 'control'] as const) {
        p.ratings.pit[k] += dp;
        p.pot[k] += dp;
      }
    } else {
      for (const s of [p.ratings.vL, p.ratings.vR, p.pot.bat]) for (const k of Object.keys(s) as (keyof BatSplit)[]) s[k] += dh / 0.85;
    }
  }
}
