// Exclusive window and successor contracts.
//   node --experimental-strip-types scripts/check-window.ts
let seed = 11 >>> 0;
Math.random = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
import { createLeague } from '../src/core/league.ts';
import { simOneDay } from '../src/core/sim/day.ts';
import { advanceDraft } from '../src/core/draft.ts';
import { extAsk, inExclusiveWindow, offerExtension, pendingFreeAgent, stayChance } from '../src/core/extensions.ts';
import { pendingMilbFa, successorOdds, offerSuccessor, oddsLabel } from '../src/core/successor.ts';
import { orgPlayers } from '../src/core/util.ts';
const L = createLeague({ name: 'w', userOrgIndex: 3, season: 2027 });
for (const k of Object.keys(L.orgs[3].agm)) (L.orgs[3].agm as Record<string, boolean>)[k] = true;
for (const s of L.staff) if (s.orgId === 3) s.exp = 2100;
const t0 = performance.now();
for (let d = 0; d < 400 && !inExclusiveWindow(L); d++) { const r = simOneDay(L); if (r.stop?.includes('clock')) advanceDraft(L, true); }
console.log(`reached window in ${((performance.now() - t0) / 1000).toFixed(0)}s: phase ${L.phase}, day ${L.day}, ws ${L.wsEndDay}`);
simOneDay(L); // first window day: notice + AGM successors
console.log((L.inbox ?? []).filter((m) => /Exclusive|Successor/.test(m.subject)).map((m) => `[${m.subject}] ${m.text}`).join('\n'));
// League-wide: stay chances for pending ML FAs.
const all = Object.values(L.players).filter((p) => p.orgId !== null && pendingFreeAgent(L, p));
const sc = all.map((p) => stayChance(L, p)).sort((a, b) => a - b);
console.log(`${all.length} pending ML FAs, stay chance p10 ${sc[Math.floor(sc.length * 0.1)].toFixed(2)} median ${sc[Math.floor(sc.length / 2)].toFixed(2)} p90 ${sc[Math.floor(sc.length * 0.9)].toFixed(2)}`);
// Simulated acceptance at a fair offer (ask) and +10% for every pending FA.
for (const bump of [1, 1.1]) {
  let yes = 0; const reasons: Record<string, number> = {};
  for (const p of all) {
    const o = p.orgId!;
    const c = JSON.parse(JSON.stringify(p));
    const ask = extAsk(L, p, 3);
    const t = { sched: [0, 0, 0].map(() => Math.round((ask.total * bump) / 3)) } as Parameters<typeof offerExtension>[2];
    const saveOrg = L.userOrgId; L.userOrgId = o;
    const r = offerExtension(L, p, t, o);
    L.userOrgId = saveOrg;
    if (r.ok) yes++;
    reasons[r.text.replace(/^.*?(turned|appreciates|agent|decided|One offer|He )/, '$1').slice(0, 40)] = (reasons[r.text.replace(/^.*?(turned|appreciates|agent|decided|One offer|He )/, '$1').slice(0, 40)] ?? 0) + 1;
    Object.assign(p, c); p.ext = c.ext ?? null; // undo
  }
  console.log(reasons);
  console.log(`offer at ${bump}x ask: ${yes}/${all.length} accept (${(100 * yes / all.length).toFixed(0)}%)`);
}
const mine = orgPlayers(L, 3).filter((p) => pendingMilbFa(L, p));
console.log(`user pending MiLB FAs: ${mine.length}; offered: ${mine.filter((p) => p.successor).length}`);
for (const p of mine.slice(0, 8)) console.log(`  ${p.first} ${p.last} ${p.level} age ${L.season + 1 - p.born} loy ${p.personality.loyalty}: same level ${oddsLabel(successorOdds(L, p, p.level!, false))} (${successorOdds(L, p, p.level!, false).toFixed(2)}), AAA+invite ${successorOdds(L, p, 'AAA', true).toFixed(2)}`);
const extra = mine.find((p) => !p.successor);
if (extra) console.log('manual offer:', offerSuccessor(L, extra, 'AAA', true) ?? 'sent');
for (let i = 0; i < 6 && L.phase === 'offseason'; i++) simOneDay(L);
const after = orgPlayers(L, 3).filter((p) => p.successor?.season === L.season);
console.log('answers:', after.map((p) => `${p.last} ${p.successor!.answer}`).join(', '));
console.log('stayed in org with new deal:', after.filter((p) => p.successor!.answer === 'yes').every((p) => p.orgId === 3 && p.contract.exp === L.season + 1));
console.log('decliners are FAs now:', after.filter((p) => p.successor!.answer === 'no').every((p) => p.orgId === null));
console.log((L.inbox ?? []).filter((m) => /re-signed|test the market/.test(m.subject)).slice(0, 3).map((m) => m.text).join('\n'));
