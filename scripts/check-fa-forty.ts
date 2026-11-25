let seed = 7 >>> 0;
Math.random = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
import { createLeague } from '../src/core/league.ts';
import { simOneDay } from '../src/core/sim/day.ts';
import { advanceDraft } from '../src/core/draft.ts';
import { makeOffer, offerScore } from '../src/core/freeAgency.ts';
import { fortyMan, orgPlayers } from '../src/core/util.ts';
import { dayLabel } from '../src/core/settings.ts';
import { ovr } from '../src/core/ratings.ts';
const L = createLeague({ name: 'm', userOrgIndex: 3, season: 2027 });
const U = L.orgs[3];
for (const k of Object.keys(U.agm)) (U.agm as any)[k] = true;
(U.agm as any).fa = false;
let g = 0;
while (g++ < 500 && !(L.phase === 'preseason' && dayLabel(L.season, L.day).startsWith('Feb 20'))) { const r = simOneDay(L); if (r.stop?.includes('clock')) advanceDraft(L, true); }
// Fill the 40-man to 39 plus one on the 60-day IL.
const f40 = () => fortyMan(L, U.id).length;
const off40 = orgPlayers(L, U.id).filter((p) => !p.on40 && p.level !== 'MLB');
while (f40() < 39 && off40.length) off40.pop()!.on40 = true;
const il = fortyMan(L, U.id).find((p) => p.level === 'MLB')!;
const extra = off40.pop()!; extra.on40 = true;
il.il = { type: 'IL60', since: L.day } as any;
console.log('40-man shown', f40(), 'raw on40', orgPlayers(L, U.id).filter((p) => p.on40).length);
const fa = Object.values(L.players).filter((p) => p.fa && p.orgId === null && ovr(p) >= 45).filter((p) => !p.fa!.offers.length).sort((a, b) => ovr(a) - ovr(b))[0];
console.log('offer', fa.last, makeOffer(L, fa, U.id, fa.fa!.asking.years, fa.fa!.asking.aav * 1.05), 'score', offerScore(L, fa, fa.fa!.offers.find((o) => o.orgId === U.id)!).toFixed(2), 'decides', dayLabel(L.season, fa.fa!.decideDay));
for (let i = 0; i < 25; i++) { simOneDay(L); if (fa.orgId !== null) break; }
console.log(dayLabel(L.season, L.day), fa.orgId === null ? `unsigned, now decides ${dayLabel(L.season, fa.fa!.decideDay)}, asking ${(fa.fa!.asking.aav/1e6).toFixed(2)}` : `signed with ${L.orgs[fa.orgId].abbrev}`);
