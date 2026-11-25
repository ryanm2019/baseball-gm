// Who's hot and who's cold (like MLB The Show): a rolling, fading record of
// each player's last couple of weeks, compared with his own season so far.
// Display only; it doesn't change how players perform.
import type { BatStats, League, PitStats, Player } from './types.ts';
import { isPitcher } from './ratings.ts';
import { sumBat, sumPit } from './util.ts';

export interface Form { season: number; day: number; n: number; v: number; f?: number }

// wOBA-style run value of a batting line.
const wobaNum = (b: Pick<BatStats, 'h' | 'd' | 't' | 'hr' | 'bb' | 'hbp'>) => 0.69 * (b.bb + b.hbp) + 0.89 * (b.h - b.d - b.t - b.hr) + 1.27 * b.d + 1.62 * b.t + 2.1 * b.hr;
const fipNum = (s: Pick<PitStats, 'hr' | 'bb' | 'hbp' | 'k'>) => 13 * s.hr + 3 * (s.bb + s.hbp) - 2 * s.k;

export function recordBatForm(league: League, p: Player, line: BatStats): void {
  if (!line.pa) return;
  const f = p.form && p.form.season === league.season ? p.form : { season: league.season, day: league.day, n: 0, v: 0 };
  // Each game fades the old ones: roughly the last ten games count.
  f.n = f.n * 0.9 + line.pa;
  f.v = f.v * 0.9 + wobaNum(line);
  f.day = league.day;
  p.form = f;
}

export function recordPitForm(league: League, p: Player, line: PitStats): void {
  if (!line.bf) return;
  const f = p.form && p.form.season === league.season ? p.form : { season: league.season, day: league.day, n: 0, v: 0, f: 0 };
  // Starters: about the last four starts; relievers: about the last eight outings.
  const k = line.gs ? 0.75 : 0.88;
  const ip = line.outs / 3;
  f.n = f.n * k + ip;
  f.v = f.v * k + line.er;
  f.f = (f.f ?? 0) * k + fipNum(line);
  f.day = league.day;
  p.form = f;
}

export type Heat = { kind: 'hot' | 'cold'; text: string; short: string } | null;

// Hot or cold: his recent stretch against his season (pulled toward average).
export function heat(league: League, p: Player): Heat {
  const f = p.form;
  if (!f || f.season !== league.season || league.day - f.day > 10 || league.phase === 'offseason' || league.phase === 'preseason') return null;
  const level = p.level ?? 'MLB';
  const entries = p.stats.filter((s) => s.season === league.season && s.level === level);
  if (isPitcher(p)) {
    const minIp = p.pos === 'SP' ? 9 : 6;
    if (f.n < minIp) return null;
    const recent = 0.5 * ((9 * f.v) / f.n) + 0.5 * ((f.f ?? 0) / f.n + 3.1);
    const s = sumPit(entries);
    const sIp = s.outs / 3;
    const base = (0.5 * 9 * s.er + 0.5 * (fipNum(s) + 3.1 * sIp) + 4.2 * 30) / (sIp + 30);
    const ra = recent.toFixed(2);
    if (recent <= base - (p.pos === 'SP' ? 1.2 : 1.6) && recent <= (p.pos === 'SP' ? 3.2 : 2.6)) return { kind: 'hot', text: `Hot: about a ${ra} ERA/FIP blend lately (season ${base.toFixed(2)})`, short: `${ra} ERA lately` };
    if (recent >= base + (p.pos === 'SP' ? 1.5 : 2.2) && recent >= (p.pos === 'SP' ? 5.2 : 6.0)) return { kind: 'cold', text: `Cold: about a ${ra} ERA/FIP blend lately (season ${base.toFixed(2)})`, short: `${ra} ERA lately` };
    return null;
  }
  if (f.n < 22) return null;
  const recent = f.v / f.n;
  const b = sumBat(entries);
  const base = (wobaNum(b) + 0.315 * 120) / (b.pa + 120);
  const w = recent.toFixed(3).replace(/^0/, '');
  if (recent >= base + 0.065 && recent >= 0.36) return { kind: 'hot', text: `Hot: ${w} wOBA over his last ~10 games (normal ${base.toFixed(3).replace(/^0/, '')})`, short: `${w} wOBA, last 10` };
  if (recent <= base - 0.07 && recent <= 0.27) return { kind: 'cold', text: `Cold: ${w} wOBA over his last ~10 games (normal ${base.toFixed(3).replace(/^0/, '')})`, short: `${w} wOBA, last 10` };
  return null;
}
