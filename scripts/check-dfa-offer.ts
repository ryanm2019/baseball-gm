// Designate a useful player and see whether an interested club calls with a small trade.
//   node --experimental-strip-types scripts/check-dfa-offer.ts
let seed = 3 >>> 0;
Math.random = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
import { createLeague } from '../src/core/league.ts';
import { simOneDay } from '../src/core/sim/day.ts';
import { designate } from '../src/core/rules.ts';
import { answerDfaOffer } from '../src/core/dfaMarket.ts';
import { fortyMan } from '../src/core/util.ts';
import { ovr, potOvr } from '../src/core/ratings.ts';
const L = createLeague({ name: 'd', userOrgIndex: 3, season: 2027 });
for (const k of Object.keys(L.orgs[3].agm)) (L.orgs[3].agm as Record<string, boolean>)[k] = true;
for (const s of L.staff) if (s.orgId === 3) s.exp = 2100;
for (let d = 0; d < 20; d++) simOneDay(L);
let calls = 0, tries = 0;
// Designate the user's 40-man minor leaguers one at a time and watch the phone.
for (const p of fortyMan(L, 3).filter((q) => q.level !== 'MLB').sort((a, b) => ovr(b) - ovr(a)).slice(0, 8)) {
  tries++;
  designate(L, p);
  for (let d = 0; d < 6 && p.dfa; d++) simOneDay(L);
  const m = (L.inbox ?? []).find((x) => x.kind === 'dfa-offer' && x.dfaDeal?.pid === p.id);
  console.log(`${p.first} ${p.last} ${p.pos} ${ovr(p).toFixed(0)}/${potOvr(p).toFixed(0)}: ${m ? m.text.slice(0, 160) : 'no call'}`);
  if (m) { calls++; if (calls === 1) console.log('   accept ->', answerDfaOffer(L, m, 'accept'), '| now with', p.orgId === 3 ? 'you' : L.orgs[p.orgId!].abbrev, 'on40', p.on40); }
}
console.log(`calls ${calls}/${tries}`);
