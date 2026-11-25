// In-season player development, run once a month. Young players move toward
// their potential; veterans decline. Work ethic, playing time and the
// organization's farm director all change the pace.
import type { BatSplit, DefRatings, League, Player } from './types.ts';
import { moraleDev } from './morale.ts';
import { clamp, normal } from './random.ts';
import { isPitcher, ovr } from './ratings.ts';
import { devMultiplier } from './staff.ts';
import { levelPlus } from './war.ts';

// Growth is steadier before 22 and strongest from 22 to 26, so most players
// peak at 25-28 (a teenage star is rare, not routine).
function ageRate(a: number): number {
  if (a <= 20) return 0.027;
  if (a <= 21) return 0.031;
  if (a <= 23) return 0.038;
  if (a <= 26) return 0.033;
  if (a <= 29) return 0.013;
  return 0;
}

// Hitting tools (and speed) at 72 or better.
function eliteTools(p: Player, pot = false): number {
  const keys: (keyof BatSplit)[] = ['babip', 'avoidK', 'gap', 'power', 'eye'];
  const r = (k: keyof BatSplit) => (pot ? p.pot.bat[k] : 0.7 * p.ratings.vR[k] + 0.3 * p.ratings.vL[k]);
  return keys.filter((k) => r(k) >= 72).length + ((pot ? p.pot.speed : p.ratings.run.speed) >= 72 ? 1 : 0);
}

// Decline starts at 32 and accelerates gently; elite players (and hard
// workers) hold their skills longer.
function decline(a: number, p: Player): number {
  if (a < 32) return 0;
  const elite = ovr(p) >= 60 ? 0.75 : 1;
  const work = 1.1 - (0.2 * (p.personality.workEthic - 20)) / 60;
  return (a - 31) * 0.065 * elite * work;
}

// A minor leaguer dominating his level (130+ on the plus scale over 100+ PA or
// batters faced) develops up to ~20% faster while he keeps it up.
export function crushBoost(league: League, p: Player, age = league.season - p.born): number {
  if (!p.level || p.level === 'MLB' || age > 27) return 1;
  const r = levelPlus(league, p, league.season, p.level);
  if (!r || r.n < 100 || r.plus < 130) return 1;
  return 1 + Math.min(0.2, (r.plus - 125) / 250);
}

export function developPlayer(league: League, p: Player): void {
  const a = league.season - p.born;
  const we = 0.7 + (0.6 * (p.personality.workEthic - 20)) / 60;
  const fdm = devMultiplier(league, p);
  // Playing time this season at any level (a call-up or demotion doesn't reset it).
  let pa = 0, outs = 0;
  for (const s of p.stats) if (s.season === league.season) { pa += s.bat.pa; outs += s.pit.outs; }
  const playing = pa > 25 || outs > 30 ? 1 : 0.6;
  const rate = ageRate(a) * we * fdm * playing * moraleDev(p) * crushBoost(league, p, a) * (a >= 22 && a <= 28 ? (league.devAdj ?? 1) : 1);
  const dec = decline(a, p);
  const tcr = 0.45;

  // Stacking elite tools gets harder: past three, each extra one slows growth above 70.
  const stack = isPitcher(p) ? 1 : 1 / (1 + 0.3 * Math.max(0, eliteTools(p) - 3));
  const move = (cur: number, pot: number) => clamp(cur + Math.max(0, pot - cur) * rate * (cur >= 70 ? stack : 1) + normal(0, tcr) - dec, 15, 85);

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
  // Drafted high schoolers swing more (more busts and late bloomers); college players have a higher floor.
  const vol = p.devVol ?? 1;
  // About half the downward drift it used to have: more prospects get close to their grade.
  const d = normal(vol > 1 ? -0.55 : vol < 1 ? -0.3 : -0.45, 2.6 * vol) + (p.personality.workEthic - 50) / 30;
  const bump = (cur: number, pot: number) => clamp(Math.max(cur, pot + d), 15, 85);
  if (isPitcher(p)) {
    p.pot.stuff = bump(p.ratings.pit.stuff, p.pot.stuff);
    p.pot.movement = bump(p.ratings.pit.movement, p.pot.movement);
    p.pot.control = bump(p.ratings.pit.control, p.pot.control);
  } else {
    const keys: (keyof BatSplit)[] = ['babip', 'avoidK', 'gap', 'power', 'eye'];
    // Five-tool ceilings usually don't all hold: with five or more elite tools,
    // the elite ones tend to stall a little each year.
    const many = eliteTools(p, true) >= 5;
    for (const k of keys) {
      const extra = many && p.pot.bat[k] >= 72 ? normal(-0.7, 0.8) : 0;
      p.pot.bat[k] = clamp(Math.max(0.7 * p.ratings.vR[k] + 0.3 * p.ratings.vL[k], p.pot.bat[k] + d + extra), 15, 85);
    }
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
