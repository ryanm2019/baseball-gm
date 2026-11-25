// Player development audit: how high-upside young players actually grow.
//   node --experimental-strip-types scripts/audit-dev.ts [seasons=4] [seed=9]
let seed = Number(process.argv[3] ?? 9) >>> 0;
Math.random = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
import { createLeague } from '../src/core/league.ts';
import { simOneDay } from '../src/core/sim/day.ts';
import { advanceDraft } from '../src/core/draft.ts';
import { ovr, potOvr, isPitcher } from '../src/core/ratings.ts';
import type { League, Player } from '../src/core/types.ts';

const SEASONS = Number(process.argv[2] ?? 4);
const L: League = createLeague({ name: 'dev', userOrgIndex: 3, season: 2027 });
for (const k of Object.keys(L.orgs[3].agm)) (L.orgs[3].agm as Record<string, boolean>)[k] = true;
const S0 = L.season;
for (const s of L.staff) if (s.orgId === 3) s.exp = 2100;
interface Track { id: number; age0: number; ovr0: number; pot0: number; snaps: { season: number; ovr: number; pot: number }[]; months: string[]; slow: number; total: number }
const T = new Map<number, Track>();
// Cohort: young players with real upside at the start.
for (const p of Object.values(L.players)) {
  if (p.orgId === null || p.prospect || p.ifa) continue;
  const age = L.season - p.born;
  if (age <= 25 && potOvr(p) >= 58 && potOvr(p) - ovr(p) >= 8) T.set(p.id, { id: p.id, age0: age, ovr0: ovr(p), pot0: potOvr(p), snaps: [], months: [], slow: 0, total: 0 });
}
let lastMonth = -1, guard = 0, lastStop = '';
while (L.season < S0 + SEASONS && guard++ < 420 * SEASONS) {
  const r = simOneDay(L);
  if (r.stop) lastStop = r.stop;
  if (r.stop?.includes('clock')) advanceDraft(L, true);
  if (L.phase === 'regular' && L.day === 1) for (const t of T.values()) { const p = L.players[t.id]; if (p && !p.retired) t.snaps.push({ season: L.season, ovr: ovr(p), pot: potOvr(p) }); }
  // Monthly: where is he, and does the dev code count him as "playing"?
  if (L.phase === 'regular' && L.day % 30 === 29 && L.day !== lastMonth) {
    lastMonth = L.day;
    for (const t of T.values()) {
      const p = L.players[t.id];
      if (!p || p.retired || p.orgId === null) continue;
      t.months.push(p.level ?? '-');
      const e = p.stats.find((s) => s.season === L.season && s.orgId === p.orgId && s.level === p.level);
      t.total++;
      if (!(e && (e.bat.pa > 25 || e.pit.outs > 30))) t.slow++;
    }
  }
}
const tr = [...T.values()].filter((t) => t.snaps.length >= 2);
const end = (t: Track) => { const p = L.players[t.id]; return { ovr: ovr(p), pot: potOvr(p), age: L.season - p.born }; };
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (a: number, b: number) => `${b ? Math.round((100 * a) / b) : 0}%`;
console.log(`Cohort: ${tr.length} players (age <=25, pot 58+, gap 8+) followed ${SEASONS} seasons from ${S0}`);
console.log(`\nBy starting age: ovr gain, potential change, share of the starting gap closed, share now within 3 of starting potential`);
for (const [lo, hi] of [[18, 20], [21, 22], [23, 24], [25, 25]]) {
  const g = tr.filter((t) => t.age0 >= lo && t.age0 <= hi);
  if (!g.length) continue;
  const gain = g.map((t) => end(t).ovr - t.ovr0), dpot = g.map((t) => end(t).pot - t.pot0), closed = g.map((t) => (end(t).ovr - t.ovr0) / (t.pot0 - t.ovr0));
  console.log(`  age ${lo}-${hi} (n ${g.length}): +${avg(gain).toFixed(1)} ovr, pot ${avg(dpot) >= 0 ? '+' : ''}${avg(dpot).toFixed(1)}, gap closed ${Math.round(100 * avg(closed))}%, reached start pot ${pct(g.filter((t) => end(t).ovr >= t.pot0 - 3).length, g.length)}, beat it ${pct(g.filter((t) => end(t).ovr > t.pot0).length, g.length)}`);
}
console.log(`\nPer season (all cohort): ovr gain by year`);
for (let y = 1; y < SEASONS; y++) {
  const g = tr.filter((t) => t.snaps.length > y);
  console.log(`  year ${y}: +${avg(g.map((t) => t.snaps[y].ovr - t.snaps[y - 1].ovr)).toFixed(2)} ovr, pot ${avg(g.map((t) => t.snaps[y].pot - t.snaps[y - 1].pot)).toFixed(2)} (n ${g.length})`);
}
const shuttle = (t: Track) => { let n = 0; for (let i = 1; i < t.months.length; i++) if (t.months[i] !== t.months[i - 1] && ['MLB', 'AAA'].includes(t.months[i]) && ['MLB', 'AAA'].includes(t.months[i - 1])) n++; return n; };
const sh = tr.filter((t) => shuttle(t) >= 2), st = tr.filter((t) => shuttle(t) === 0 && t.age0 >= 21);
console.log(`\nShuttled MLB<->AAA 2+ times (n ${sh.length}): +${avg(sh.map((t) => end(t).ovr - t.ovr0)).toFixed(1)} ovr, gap closed ${Math.round(100 * avg(sh.map((t) => (end(t).ovr - t.ovr0) / (t.pot0 - t.ovr0))))}%, months counted as 'not playing' ${pct(sh.reduce((a, t) => a + t.slow, 0), sh.reduce((a, t) => a + t.total, 0))}`);
console.log(`Never shuttled, 21+ (n ${st.length}): +${avg(st.map((t) => end(t).ovr - t.ovr0)).toFixed(1)} ovr, gap closed ${Math.round(100 * avg(st.map((t) => (end(t).ovr - t.ovr0) / (t.pot0 - t.ovr0))))}%, months counted as 'not playing' ${pct(st.reduce((a, t) => a + t.slow, 0), st.reduce((a, t) => a + t.total, 0))}`);
const big = tr.filter((t) => t.pot0 >= 65);
console.log(`\nTop upside (pot 65+ at start, n ${big.length}): start ${avg(big.map((t) => t.ovr0)).toFixed(1)}/${avg(big.map((t) => t.pot0)).toFixed(1)} -> now ${avg(big.map((t) => end(t).ovr)).toFixed(1)}/${avg(big.map((t) => end(t).pot)).toFixed(1)}`);
console.log('examples:', big.slice(0, 8).map((t) => { const p = L.players[t.id]; return `${p.last} ${isPitcher(p) ? p.pos : 'H'} ${t.age0}y ${t.snaps.map((s) => `${s.ovr.toFixed(0)}/${s.pot.toFixed(0)}`).join('>')}>${end(t).ovr.toFixed(0)}/${end(t).pot.toFixed(0)}`; }).join(' | '));
{
  const act = Object.values(L.players).filter((p) => p.orgId !== null && !p.retired);
  const by = (lo: number, hi: number, min: number) => act.filter((p) => { const a = L.season - p.born; return a >= lo && a <= hi && ovr(p) >= min; }).length;
  console.log(`Young stars now: age <=21 with 60+ ${by(0, 21, 60)} (55+ ${by(0, 21, 55)}); 22-24 with 60+ ${by(22, 24, 60)}; MLB 60+ total ${act.filter((p) => p.level === 'MLB' && ovr(p) >= 60).length}, 70+ ${act.filter((p) => p.level === 'MLB' && ovr(p) >= 70).length}`);
}
console.log(`ended ${L.season} ${L.phase} day ${L.day}, guard ${guard}, last stop: ${lastStop}`);
console.log(`devAdj now ${(L.devAdj ?? 1).toFixed(2)}`);
