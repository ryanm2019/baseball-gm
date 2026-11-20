// In-season player development, run once a month. Young players move toward
// their potential; veterans decline. Work ethic, playing time and the
// organization's farm director all change the pace.
import type { BatSplit, DefRatings, League, Player } from './types.ts';
import { clamp, normal } from './random.ts';
import { isPitcher } from './ratings.ts';

function ageRate(a: number): number {
  if (a <= 20) return 0.09;
  if (a <= 23) return 0.07;
  if (a <= 26) return 0.045;
  if (a <= 29) return 0.02;
  return 0;
}

function decline(a: number): number {
  return a >= 31 ? (a - 30) * 0.11 : 0;
}

export function developPlayer(league: League, p: Player): void {
  const a = league.season - p.born;
  const fd = p.orgId === null ? undefined : league.farmDirectors.find((f) => f.orgId === p.orgId);
  const we = 0.7 + (0.6 * (p.personality.workEthic - 20)) / 60;
  const fdm = 0.85 + (0.3 * ((fd?.development ?? 40) - 20)) / 60;
  const e = p.stats.find((s) => s.season === league.season && s.orgId === p.orgId && s.level === p.level);
  const playing = e && (e.bat.pa > 25 || e.pit.outs > 30) ? 1 : 0.6;
  const rate = ageRate(a) * we * fdm * playing;
  const dec = decline(a);
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
