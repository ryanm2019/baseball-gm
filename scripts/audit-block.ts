// Audit: do clubs shop the big free agents they just signed, and why?
//   node --experimental-strip-types scripts/audit-block.ts  (needs /tmp/window.json: an October save)
let seed = 21 >>> 0;
Math.random = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
import { readFileSync } from 'node:fs';
import { migrate } from '../src/core/migrate.ts';
import { simOneDay } from '../src/core/sim/day.ts';
import { advanceDraft } from '../src/core/draft.ts';
import { orgPayroll, serviceYears } from '../src/core/contracts.ts';
import { ovr } from '../src/core/ratings.ts';
import type { League } from '../src/core/types.ts';
const L = migrate(JSON.parse(readFileSync('/tmp/window.json', 'utf8'))) as League;
for (const k of Object.keys(L.orgs[L.userOrgId].agm)) (L.orgs[L.userOrgId].agm as Record<string, boolean>)[k] = true;
type Rec = { pid: number; org: number; aav: number; yrs: number; day: number; season: number; strat: string; stance: string; payPct: number; blockedDay?: number; blockStance?: string; blockStrat?: string; traded?: number; rank: number; svc: number };
const recs: Rec[] = [];
const prevOrg = new Map<number, number | null>();
for (const p of Object.values(L.players)) prevOrg.set(p.id, p.orgId);
const ranks = () => { const r = L.orgs.map((o) => ({ id: o.id, b: o.budget })).sort((a, b) => b.b - a.b); return new Map(r.map((x, i) => [x.id, i + 1])); };
const start = performance.now();
let days = 0;
while (days < 420 && !(L.phase === 'regular' && L.day > L.settings.tradeDeadlineDay + 5)) {
  const r = simOneDay(L); if (r.stop?.includes('clock')) advanceDraft(L, true);
  days++;
  const rk = ranks();
  for (const p of Object.values(L.players)) {
    const before = prevOrg.get(p.id) ?? null;
    if (before === null && p.orgId !== null && p.contract.type === 'ML' && p.orgId !== L.userOrgId) {
      const yrs = p.contract.exp - (L.phase === 'offseason' ? L.season : L.season - 1);
      const aav = (p.contract.sched?.length ? p.contract.sched.reduce((a, b) => a + b, 0) / p.contract.sched.length : p.contract.salary);
      if (aav >= 8e6) {
        const o = L.orgs[p.orgId];
        recs.push({ pid: p.id, org: o.id, aav, yrs, day: L.day, season: L.season, strat: o.strategy, stance: o.stance, payPct: orgPayroll(L, o).cbt / o.budget, rank: rk.get(o.id)!, svc: serviceYears(p.mlServiceDays, L.settings) });
      }
    }
    prevOrg.set(p.id, p.orgId);
  }
  for (const r of recs) {
    const p = L.players[r.pid]; const o = L.orgs[r.org];
    if (r.blockedDay === undefined && p.orgId === r.org && o.block.includes(r.pid)) { r.blockedDay = days; r.blockStance = o.stance; r.blockStrat = o.strategy; }
    if (r.traded === undefined && p.orgId !== r.org && p.orgId !== null) r.traded = days;
  }
}
console.log(`simmed ${days} days in ${((performance.now() - start) / 1000).toFixed(0)}s, now ${L.phase} day ${L.day}`);
console.log(`big FA signings (AAV >= $8M, AI clubs): ${recs.length}`);
const blocked = recs.filter((r) => r.blockedDay !== undefined);
console.log(`put on the block by their new club: ${blocked.length} (${(100 * blocked.length / recs.length).toFixed(0)}%), traded: ${recs.filter((r) => r.traded !== undefined).length}`);
const by = (k: (r: Rec) => string) => { const m: Record<string, [number, number]> = {}; for (const r of recs) { const x = (m[k(r)] ??= [0, 0]); x[0]++; if (r.blockedDay !== undefined) x[1]++; } return Object.entries(m).map(([a, [n, b]]) => `${a}: ${b}/${n}`).join(' | '); };
console.log('by strategy at signing:', by((r) => r.strat));
console.log('by stance at signing:  ', by((r) => r.stance));
console.log('stance when blocked:', Object.entries(blocked.reduce((m, r) => { m[`${r.blockStrat}/${r.blockStance}`] = (m[`${r.blockStrat}/${r.blockStance}`] ?? 0) + 1; return m; }, {} as Record<string, number>)).map(([a, b]) => `${a} ${b}`).join(', '));
console.log('years on deal, blocked:', blocked.map((r) => r.yrs).sort().join(','));
console.log('service years of signees: min', Math.min(...recs.map((r) => r.svc)).toFixed(1), 'blocked with 5+ svc:', blocked.filter((r) => r.svc >= 5).length);
console.log('payroll/budget at signing: median', recs.map((r) => r.payPct).sort()[Math.floor(recs.length / 2)].toFixed(2), '| blocked median', blocked.length ? blocked.map((r) => r.payPct).sort()[Math.floor(blocked.length / 2)].toFixed(2) : '-');
console.log('days from signing to block (median):', blocked.length ? blocked.map((r) => r.blockedDay! - 0).sort((a, b) => a - b)[Math.floor(blocked.length / 2)] : '-');
console.log('budget rank (1 = biggest) of signing clubs, blocked:', blocked.map((r) => r.rank).sort((a, b) => a - b).join(','));
console.log('\nend-of-sim payroll vs budget by org:');
console.log(L.orgs.map((o) => `${o.abbrev} ${(orgPayroll(L, o).cbt / 1e6).toFixed(0)}/${(o.budget / 1e6).toFixed(0)} ${o.strategy[0]}${o.stance[0]}`).join('  '));
for (const r of blocked.slice(0, 12)) { const p = L.players[r.pid]; console.log(`  ${p.first} ${p.last} age ${L.season - p.born} ovr ${ovr(p)} ${r.yrs}y $${(r.aav / 1e6).toFixed(1)}M -> ${L.orgs[r.org].abbrev} signed as ${r.strat}/${r.stance}, blocked as ${r.blockStrat}/${r.blockStance}${r.traded ? ', traded' : ''}`); }
