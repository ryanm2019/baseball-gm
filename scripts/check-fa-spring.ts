// Free agents still on the market when spring training starts keep deciding,
// and facilities move week by week.
//   node --experimental-strip-types scripts/check-fa-spring.ts [seed=5]
let seed = Number(process.argv[2] ?? 5) >>> 0;
Math.random = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
import { createLeague } from '../src/core/league.ts';
import { simOneDay } from '../src/core/sim/day.ts';
import { advanceDraft } from '../src/core/draft.ts';
import { ovr } from '../src/core/ratings.ts';
import { makeOffer } from '../src/core/freeAgency.ts';
import { dayLabel } from '../src/core/settings.ts';
import { deptEffect } from '../src/core/depts.ts';
import type { League } from '../src/core/types.ts';

const L: League = createLeague({ name: 'faspring', userOrgIndex: 3, season: 2027 });
const U = L.orgs[3];
for (const k of Object.keys(U.agm)) (U.agm as Record<string, boolean>)[k] = true;
(U.agm as Record<string, boolean>).trades = false;
(U.agm as Record<string, boolean>).fa = false;
U.depts.facilities = 50e6;
const fac: string[] = [];
let guard = 0, offered: number[] = [];
const unsigned = () => Object.values(L.players).filter((p) => p.fa && p.orgId === null && p.fa.asking.aav > 8e6 && !p.retired);
while (guard++ < 600) {
  const r = simOneDay(L);
  if (L.phase === "regular" && L.season > 2027 && L.day === 0 && r.stop) { console.log("stop:", r.stop); break; }
  if (r.stop?.includes('clock')) advanceDraft(L, true);
  if (L.day % 56 === 0) fac.push(`${dayLabel(L.season, L.day)} ${(deptEffect(U, 'facilities') * 6).toFixed(2)}%`);
  // Late January: bid on two free agents at about their asking price.
  if (L.phase === 'offseason' && !offered.length && dayLabel(L.season, L.day).startsWith('Feb 1,')) {
    const cands = Object.values(L.players).filter((p) => p.fa && p.orgId === null && ovr(p) >= 45 && ovr(p) < 55).sort((a, b) => b.fa!.decideDay - a.fa!.decideDay).slice(0, 2);
    for (const p of cands) { console.log(`offer ${p.first} ${p.last} ${p.fa!.asking.years}x${(p.fa!.asking.aav / 1e6).toFixed(2)} decides ${dayLabel(L.season, p.fa!.decideDay)}`, makeOffer(L, p, U.id, p.fa!.asking.years, p.fa!.asking.aav)); offered.push(p.id); }
    console.log(`Feb 1: ${unsigned().length} unsigned asking >$8M`);
  }
  if (L.phase === 'preseason' && offered.length && dayLabel(L.season, L.day).startsWith('Mar 1,')) {
    for (const id of offered) { const p = L.players[id]; console.log(`${p.first} ${p.last}: ${p.orgId === null ? `still unsigned, decides ${dayLabel(L.season, p.fa!.decideDay)}` : `signed with ${L.orgs[p.orgId].affiliates.MLB.name}`}`); }
    console.log(`Mar 1: ${unsigned().length} unsigned asking >$8M; decide dates: ${unsigned().slice(0, 6).map((p) => dayLabel(L.season, p.fa!.decideDay)).join(', ')}`);
  }
  if (L.phase === 'regular' && L.season > 2027 && L.day === 1) { console.log(`Opening Day ${L.season}: ${unsigned().length} unsigned asking >$8M`); break; }
}
console.log('facilities appeal (budget doubled):', fac.join(' | '));
