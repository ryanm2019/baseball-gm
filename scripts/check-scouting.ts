// Scouting: monthly plans, reports, rush reports, and whether reports sharpen the read.
//   node --experimental-strip-types scripts/check-scouting.ts
let seed = 8 >>> 0;
Math.random = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
import { createLeague } from '../src/core/league.ts';
import { simOneDay } from '../src/core/sim/day.ts';
import { rushMany, scouting, scoutPlan } from '../src/core/scouting.ts';
import { ovr, potOvr, scoutRaw, displayOvr } from '../src/core/ratings.ts';
import { dayLabel } from '../src/core/settings.ts';
const L = createLeague({ name: 's', userOrgIndex: 3, season: 2027 });
for (const k of Object.keys(L.orgs[3].agm)) (L.orgs[3].agm as Record<string, boolean>)[k] = true;
for (const s of L.staff) if (s.orgId === 3) s.exp = 2100;
const t0 = Date.now();
for (let d = 0; d < 60; d++) simOneDay(L);
const st = scouting(L);
console.log(dayLabel(L.season, L.day), 'plan:', scoutPlan(L).mode, '| reports on file', Object.keys(st.reports).length, '| still planned', st.plan.length, `| ${((Date.now() - t0) / 60).toFixed(0)} ms/day`);
const other = Object.values(L.players).filter((p) => p.orgId !== null && p.orgId !== 3 && p.level === 'MLB').slice(0, 3);
console.log(rushMany(L, other.map((p) => p.id)));
for (let d = 0; d < 2; d++) simOneDay(L);
const inbox = (L.inbox ?? []).filter((m) => /Rush report|Scouting:/.test(m.subject));
for (const m of inbox.slice(-2)) console.log(' >', m.subject, '::', m.text.slice(0, 260));
// Does a report sharpen the read? The same players' error with and without their report.
const rep = Object.keys(st.reports).map(Number).filter((id) => L.players[id].orgId !== null && L.players[id].orgId !== 3);
const errOf = (id: number) => { const p = L.players[id]; return Math.abs(scoutRaw(L, p, 'pot', potOvr(p), true) - potOvr(p)) + Math.abs(scoutRaw(L, p, 'ovr', ovr(p)) - ovr(p)); };
let withR = 0, without = 0;
for (const id of rep) { withR += errOf(id); const r = st.reports[id]; delete st.reports[id]; without += errOf(id); st.reports[id] = r; }
console.log(`read error on ${rep.length} reported players (ovr + pot): ${(withR / rep.length).toFixed(2)} with the report vs ${(without / rep.length).toFixed(2)} without`);
const one = st.reports[rep[0]];
console.log('sample report:', JSON.stringify({ ...one, tools: one.tools.map((t) => `${t.label} ${t.v}`).join(', ') }).slice(0, 400));
void ovr; void displayOvr;
