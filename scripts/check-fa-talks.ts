// Free agent talks: your offer gets an agent reply (sign / counter / not close),
// you hear when topped, and accepting a counter closes the deal.
//   node --experimental-strip-types scripts/check-fa-talks.ts [seed=11]
let seed = Number(process.argv[2] ?? 11) >>> 0;
Math.random = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
import { createLeague } from '../src/core/league.ts';
import { simOneDay } from '../src/core/sim/day.ts';
import { advanceDraft } from '../src/core/draft.ts';
import { makeOffer } from '../src/core/freeAgency.ts';
import { answerFaReply } from '../src/core/faTalks.ts';
import { dayLabel } from '../src/core/settings.ts';
import { ovr } from '../src/core/ratings.ts';
const L = createLeague({ name: 't', userOrgIndex: 3, season: 2027 });
const U = L.orgs[3];
for (const k of Object.keys(U.agm)) (U.agm as Record<string, boolean>)[k] = true;
(U.agm as Record<string, boolean>).fa = false;
for (const s of L.staff) if (s.orgId === 3) s.exp = 2100;
let g = 0;
while (g++ < 600 && !(L.phase === 'offseason' && L.players && Object.values(L.players).filter((p) => p.fa && p.orgId === null && p.fa.asking.aav > 8e6).length > 10)) { const r = simOneDay(L); if (r.stop?.includes('clock')) advanceDraft(L, true); }
console.log('FA open:', dayLabel(L.season, L.day));
const opened = new Map<number, number>();
for (const p of Object.values(L.players)) if (p.fa && p.orgId === null && p.fa.asking.aav > 8e6) opened.set(p.id, L.day);
const targets = Object.values(L.players).filter((p) => p.fa && p.orgId === null && p.fa.asking.aav > 8e6).sort((a, b) => ovr(b) - ovr(a)).slice(2, 5);
for (const p of targets) console.log('offer', p.last, `ask ${p.fa!.asking.years}x${(p.fa!.asking.aav / 1e6).toFixed(1)}M`, makeOffer(L, p, U.id, p.fa!.asking.years, p.fa!.asking.aav * 0.85), 'decides', dayLabel(L.season, p.fa!.decideDay));
const seen = new Set<number>();
for (let d = 0; d < 25; d++) {
  simOneDay(L);
  for (const m of L.inbox ?? []) {
    if (seen.has(m.id) || !m.pids.some((id) => targets.some((t) => t.id === id))) continue;
    seen.add(m.id);
    console.log(`  ${dayLabel(L.season, L.day)} [${m.kind}] ${m.subject} :: ${m.text.slice(0, 200)}`);
    if (m.kind === 'fa-reply') console.log('    -> accept:', answerFaReply(L, m, 'accept'));
  }
}
for (const p of targets) console.log(p.last, '->', p.orgId === U.id ? 'signed with you' : p.orgId !== null ? `signed with ${L.orgs[p.orgId].abbrev}` : p.fa?.pending ? 'pending (roster move)' : 'unsigned');
// Market pace: notable free agents, days to sign.
for (let d = 0; d < 120 && L.phase !== 'preseason'; d++) simOneDay(L);
const days = [...opened].map(([id, d0]) => { const p = L.players[id]; return p.orgId !== null ? (p.faSigned ? 1 : 1) : 0; });
const signed = [...opened.keys()].filter((id) => L.players[id].orgId !== null).length;
console.log(`by ${dayLabel(L.season, L.day)}: ${signed}/${opened.size} notable free agents signed`);
void days;
