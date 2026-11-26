// Farm system rankings: grade distribution, org spread, published editions.
//   node --experimental-strip-types scripts/check-farm-rank.ts
let seed = 6 >>> 0;
Math.random = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
import { createLeague } from '../src/core/league.ts';
import { simOneDay } from '../src/core/sim/day.ts';
import { advanceDraft } from '../src/core/draft.ts';
import { editions, fvLabel, liveRankings } from '../src/core/farmRank.ts';
import { dayLabel } from '../src/core/settings.ts';
const L = createLeague({ name: 'f', userOrgIndex: 3, season: 2027 });
for (const k of Object.keys(L.orgs[3].agm)) (L.orgs[3].agm as Record<string, boolean>)[k] = true;
for (const s of L.staff) if (s.orgId === 3) s.exp = 2100;
const t = performance.now();
const live = liveRankings(L);
console.log(`live rankings in ${(performance.now() - t).toFixed(0)} ms`);
const dist: Record<string, number> = {};
for (const r of live.top100) dist[fvLabel(r.fv)] = (dist[fvLabel(r.fv)] ?? 0) + 1;
console.log('top 100 by FV:', dist, '| No. 100 is', fvLabel(live.top100[99].fv));
console.log('org scores:', live.orgs.map((o) => `${L.orgs[o.orgId].abbrev} ${o.score} (${o.top100})`).slice(0, 5).join(', '), '...', live.orgs.slice(-3).map((o) => `${L.orgs[o.orgId].abbrev} ${o.score} (${o.top100})`).join(', '));
for (let d = 0; d < 200 && editions(L).length < 2; d++) { const r = simOneDay(L); if (r.stop?.includes('clock')) advanceDraft(L, true); }
for (const e of editions(L)) console.log(`${e.season} ${e.label} published ${dayLabel(e.season, e.day)}: No. 1 ${L.orgs[e.orgs[0].orgId].abbrev}, user No. ${e.orgs.find((o) => o.orgId === 3)!.rank}`);
console.log((L.inbox ?? []).filter((m) => /farm rankings/.test(m.subject)).map((m) => m.text).join('\n'));
