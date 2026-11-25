// DFA / waiver audit: how many players are designated, claimed, cleared;
// DFA trade calls to you and your assistant GM's waiver flags.
//   node --experimental-strip-types scripts/check-waivers.ts [days=420] [seed=4]
let seed = Number(process.argv[3] ?? 4) >>> 0;
Math.random = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
import { createLeague } from '../src/core/league.ts';
import { simOneDay } from '../src/core/sim/day.ts';
import { advanceDraft } from '../src/core/draft.ts';
const L = createLeague({ name: 'w', userOrgIndex: 3, season: 2027 });
for (const k of Object.keys(L.orgs[3].agm)) (L.orgs[3].agm as Record<string, boolean>)[k] = true;
for (const s of L.staff) if (s.orgId === 3) s.exp = 2100;
const DAYS = Number(process.argv[2] ?? 420);
for (let d = 0; d < DAYS; d++) { const r = simOneDay(L); if (r.stop?.includes('clock')) advanceDraft(L, true); }
const tx = L.transactions;
const dfa = tx.filter((t) => t.type === 'DFA'), claims = (L.moves ?? []).filter((m) => m.type === 'Waiver claim');
const outr = tx.filter((t) => t.type === 'Outright');
const userDfa = dfa.filter((t) => t.orgId === 3).length;
const userClaimed = claims.filter((m) => m.sides.some((s) => s.orgId === 3 && !s.gets?.length)).length;
const inbox = L.inbox ?? [];
console.log(`${DAYS} days: DFAs ${dfa.length} (yours ${userDfa}) | waiver claims ${claims.length} (yours lost ${userClaimed}) | outrights ${outr.length}`);
console.log(`DFA trade calls to you: ${inbox.filter((m) => m.kind === 'dfa-offer').length} | AGM waiver flags: ${inbox.filter((m) => m.subject.startsWith('Waiver wire')).length} | claim notices: ${inbox.filter((m) => / claimed on waivers$/.test(m.subject)).length}`);
console.log('sample claims:', claims.slice(-6).map((m) => m.text).join(' | '));
for (const m of inbox.filter((m) => m.kind === 'dfa-offer' || m.subject.startsWith('Waiver wire')).slice(-3)) console.log(' >', m.subject, '::', m.text.slice(0, 230));
