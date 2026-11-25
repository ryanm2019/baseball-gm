// A free agent who picks you with a full 40-man agrees and waits for your move.
//   node --experimental-strip-types scripts/check-fa-pending.ts
let seed = 7 >>> 0;
Math.random = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
import { createLeague } from '../src/core/league.ts';
import { simOneDay } from '../src/core/sim/day.ts';
import { advanceDraft } from '../src/core/draft.ts';
import { makeOffer, offerScore } from '../src/core/freeAgency.ts';
import { fortyMan, orgPlayers } from '../src/core/util.ts';
import { designate } from '../src/core/rules.ts';
import { dayLabel } from '../src/core/settings.ts';
import { ovr } from '../src/core/ratings.ts';
const L = createLeague({ name: 'm', userOrgIndex: 3, season: 2027 });
const U = L.orgs[3];
for (const k of Object.keys(U.agm)) (U.agm as Record<string, boolean>)[k] = true;
(U.agm as Record<string, boolean>).fa = false;
for (const s of L.staff) if (s.orgId === 3) s.exp = 2100;
let g = 0;
while (g++ < 500 && !(L.phase === 'preseason' && dayLabel(L.season, L.day).startsWith('Feb 20'))) { const r = simOneDay(L); if (r.stop?.includes('clock')) advanceDraft(L, true); }
(U.agm as Record<string, boolean>).roster = false;
const off = orgPlayers(L, U.id).filter((p) => !p.on40 && p.level !== 'MLB');
while (fortyMan(L, U.id).length < 40 && off.length) off.pop()!.on40 = true;
console.log('40-man', fortyMan(L, U.id).length);
const fa = Object.values(L.players).filter((p) => p.fa && p.orgId === null && !p.fa.pending && ovr(p) >= 43 && !p.fa.offers.length && p.fa.asking.aav > L.settings.minSalary * 1.2).sort((a, b) => ovr(a) - ovr(b))[0];
console.log('offer', fa.last, makeOffer(L, fa, U.id, fa.fa!.asking.years, fa.fa!.asking.aav * 1.05));
console.log('decides', dayLabel(L.season, fa.fa!.decideDay), 'score', offerScore(L, fa, fa.fa!.offers.find((o) => o.orgId === U.id)!).toFixed(2));
for (let i = 0; i < 40 && !fa.fa?.pending && fa.orgId === null; i++) simOneDay(L);
console.log(dayLabel(L.season, L.day), 'pending:', !!fa.fa?.pending, '| inbox:', (L.inbox ?? []).slice(-3).map((m) => m.subject).join(' / '));
for (let i = 0; i < 3; i++) simOneDay(L);
console.log('3 days later, still pending:', !!fa.fa?.pending, 'orgId', fa.orgId);
const cut = fortyMan(L, U.id).filter((p) => p.level !== 'MLB').sort((a, b) => ovr(a) - ovr(b))[0];
designate(L, cut);
simOneDay(L);
console.log('after DFA of', cut.last, '->', fa.orgId === U.id ? `signed, level ${fa.level}, 40-man ${fortyMan(L, U.id).length}` : 'not signed', '|', (L.inbox ?? []).slice(-1)[0]?.subject);
