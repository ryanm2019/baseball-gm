// Qualifying offer audit: who gets one, who accepts, and whether it made sense.
//   node --experimental-strip-types scripts/audit-qo.ts [seasons=3] [seed=4]
let seed = Number(process.argv[3] ?? 4) >>> 0;
Math.random = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
import { createLeague } from '../src/core/league.ts';
import { simOneDay } from '../src/core/sim/day.ts';
import { advanceDraft } from '../src/core/draft.ts';
import { ovr } from '../src/core/ratings.ts';
import { marketValue, serviceYears } from '../src/core/contracts.ts';
import { playerWar } from '../src/core/war.ts';
import { qoAmount } from '../src/core/offseason.ts';
import type { League, Player } from '../src/core/types.ts';

const N = Number(process.argv[2] ?? 3);
const L: League = createLeague({ name: 'qo', userOrgIndex: 3, season: 2027 });
for (const k of Object.keys(L.orgs[3].agm)) (L.orgs[3].agm as Record<string, boolean>)[k] = true;
const S0 = L.season;
const M = (x: number) => `$${(x / 1e6).toFixed(1)}M`;
const done = new Set<number>();
let g = 0;
while (L.season < S0 + N && g++ < 400 * N) {
  for (const st of L.staff) if (st.orgId === 3 && st.exp <= L.season) st.exp = L.season + 2;
  const r = simOneDay(L);
  if (r.stop?.includes('clock')) advanceDraft(L, true);
  if (L.phase === 'offseason' && L.events.includes('qo-response') && !done.has(L.season)) {
    done.add(L.season);
    const qo = qoAmount(L);
    const tx = L.transactions.filter((t) => t.season === L.season && t.type === 'QO');
    const got = tx.filter((t) => t.text.startsWith('Extended')).map((t) => L.players[t.pids[0]]).filter(Boolean) as Player[];
    const acc = new Set(tx.filter((t) => t.text.includes('accepted')).map((t) => t.pids[0]));
    // Everyone eligible (6+ years, contract up, on the 40-man), for comparison.
    const eligibleAll = Object.values(L.players).filter((p) => (p.qoReceived && got.includes(p)) || (p.fa && p.fa.opened !== undefined && serviceYears(p.mlServiceDays, L.settings) >= 6));
    void eligibleAll;
    console.log(`\n=== ${L.season} winter: QO ${M(qo)}, ${got.length} offers, ${acc.size} accepted ===`);
    const rows = got.map((p) => ({ p, age: L.season + 1 - p.born, o: ovr(p), mv: marketValue(p, L.settings), war: playerWar(L, p, { from: L.season, to: L.season }), acc: acc.has(p.id) })).sort((a, b) => b.mv - a.mv);
    for (const r of rows) console.log(`  ${r.acc ? 'ACCEPTED' : 'declined'} ${r.p.pos} ${r.p.last} age ${r.age} ovr ${r.o.toFixed(0)} market ${M(r.mv)}/yr (${(r.mv / qo * 100).toFixed(0)}% of QO) ${L.season} WAR ${r.war.toFixed(1)}`);
    const weak = rows.filter((r) => r.mv < qo || r.age >= 34 || r.war < 1.5);
    console.log(`  questionable (market below the QO, 34+, or <1.5 WAR): ${weak.length}/${rows.length}`);
  }
}
