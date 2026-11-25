// Parity and luck: one or more regular seasons, the spread of records.
//   LUCK_TEAMDAY=6 node --experimental-strip-types scripts/check-parity.ts [seasons=1] [seed=21]
let seed = Number(process.argv[3] ?? 21) >>> 0;
Math.random = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
import { createLeague } from '../src/core/league.ts';
import { simOneDay } from '../src/core/sim/day.ts';
import { advanceDraft } from '../src/core/draft.ts';
import { expectedWins } from '../src/core/owners.ts';
const L = createLeague({ name: 'p', userOrgIndex: 3, season: 2027 });
for (const k of Object.keys(L.orgs[3].agm)) (L.orgs[3].agm as Record<string, boolean>)[k] = true;
for (const s of L.staff) if (s.orgId === 3) s.exp = 2100;
const N = Number(process.argv[2] ?? 1);
for (let y = 0; y < N; y++) {
  const season = L.season;
  const proj = new Map(L.orgs.map((o) => [o.id, expectedWins(L, o.id)]));
  let g = 0;
  while (!(L.phase === 'playoffs' || (L.phase !== 'regular' && L.season > season)) && g++ < 400) { const r = simOneDay(L); if (r.stop?.includes('clock')) advanceDraft(L, true); }
  const st = L.orgs.map((o) => ({ o, w: L.standings.MLB[o.id].w, l: L.standings.MLB[o.id].l, rs: L.standings.MLB[o.id].rs, ra: L.standings.MLB[o.id].ra }));
  const ws = st.map((x) => x.w).sort((a, b) => b - a);
  const mean = ws.reduce((a, b) => a + b, 0) / ws.length;
  const sd = Math.sqrt(ws.reduce((a, b) => a + (b - mean) ** 2, 0) / ws.length);
  // Luck: wins vs run differential (Pythagorean) and vs preseason projection.
  const pyth = st.map((x) => x.w - (x.w + x.l) * (x.rs ** 1.83 / (x.rs ** 1.83 + x.ra ** 1.83)));
  const psd = Math.sqrt(pyth.reduce((a, b) => a + b * b, 0) / pyth.length);
  const R = st.reduce((t, x) => t + x.rs, 0) / st.reduce((t, x) => t + x.w + x.l, 0);
  console.log(`${season} (teamDay ${process.env.LUCK_TEAMDAY ?? 6}): best ${ws[0]}, 2nd ${ws[1]}, worst ${ws[ws.length - 1]}, win sd ${sd.toFixed(1)}, 95+ ${ws.filter((w) => w >= 95).length}, <=62 ${ws.filter((w) => w <= 62).length} | R/G ${R.toFixed(2)} | Pythag luck sd ${psd.toFixed(1)} | preseason fav ${[...proj].sort((a, b) => b[1] - a[1]).slice(0, 1).map(([id]) => L.orgs[id].abbrev + ' ' + L.standings.MLB[id].w + 'W')}`);
  while (L.season === season && g++ < 800) { const r = simOneDay(L); if (r.stop?.includes('clock')) advanceDraft(L, true); }
}
