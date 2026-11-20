import { createLeague } from '../src/core/league.ts';
import { simOneDay } from '../src/core/sim/day.ts';
import { advanceDraft, offerPick, willingness, willingnessBand, demandNow, signabilityLabel, poolSpent, poolTotal } from '../src/core/draft.ts';
const L = createLeague({ name: 't', userOrgIndex: 3, season: 2027 });
const u = L.orgs[3];
u.agm.draft = false;
let g = 0;
while (!(L.draft && L.draft.done) && g++ < 300) { const r = simOneDay(L); if (r.stop?.includes('clock')) { advanceDraft(L, true); } }
const d = L.draft!;
console.log('draft done day', L.day, 'picks', d.picks.length, 'deadline', d.deadline);
const mine = d.picks.filter((pk) => pk.orgId === 3);
const pk = mine[0];
const p = L.players[pk.pid!];
console.log('my 1st:', p.prospect!.cls, signabilityLabel(L, p), 'slot', pk.slot, 'true demand', Math.round(demandNow(L, p.prospect!)));
for (const f of [0.8, 1.0, 1.1, 1.25, 1.5]) console.log('  offer', (f * pk.slot / 1e6).toFixed(2), 'M ->', willingnessBand(willingness(L, p, f * pk.slot)), (willingness(L, p, f * pk.slot) * 100).toFixed(0) + '%');
console.log('offer at 0.7x:', offerPick(L, pk, pk.slot * 0.7).text, '| again same day:', offerPick(L, pk, pk.slot).text);
// sim through deadline
while (L.day <= d.deadline && g++ < 600) { const r = simOneDay(L); void r; }
const stats: Record<string, [number, number]> = {};
for (const x of d.picks) {
  if (x.pid === null || x.orgId === 3) continue;
  const q = L.players[x.pid];
  const cls = q?.prospect?.cls ?? (q?.draft ? (q.signAge! >= 22 ? 'SR' : q.signAge! >= 20 ? 'JR' : 'HS') : '?');
  const key = `${x.round <= 1 ? 'R1' : x.round <= 10 ? 'R2-10' : 'R11+'}`;
  stats[key] ??= [0, 0];
  stats[key][1]++;
  if (x.signed) stats[key][0]++;
  void cls;
}
console.log('AI signed by round group:', Object.fromEntries(Object.entries(stats).map(([k, [a, b]]) => [k, `${a}/${b} (${Math.round((100 * a) / b)}%)`])));
const over = L.orgs.map((o) => ({ o, r: (poolSpent(L, o.id) - poolTotal(L, o.id)) / poolTotal(L, o.id) })).filter((x) => x.r > 0);
console.log('teams over pool:', over.map((x) => `${x.o.abbrev} ${(x.r * 100).toFixed(1)}%`).join(', '), '| taxes', (L.draftTax ?? []).length);
console.log('unsigned comps next year:', JSON.stringify(L.draftAdjust?.unsigned));
const returnees = Object.values(L.players).filter((q) => q.prospect && q.prospect.year > L.season);
console.log('players going to college / back to school:', returnees.length, 'e.g.', returnees.slice(0, 3).map((q) => `${q.prospect!.cls} returns ${q.prospect!.year}`).join(', '));
console.log(L.news.filter((n) => n.text.includes('bonus pool')).slice(0, 3).map((n) => n.text));
for (const x of d.picks.filter((x) => x.round === 1 && !x.signed && x.orgId !== 3).slice(0, 8)) {
  const q = L.players[x.pid!];
  console.log('unsigned R1 #', x.pick, x.label ?? '', 'slot', (x.slot / 1e6).toFixed(2), 'cls', q?.prospect?.cls, 'commit', q?.prospect?.commit?.toFixed(2), 'ask', ((q?.prospect?.asking ?? 0) / 1e6).toFixed(2), 'stiff', q?.prospect?.stiff?.toFixed(2), 'last', ((q?.prospect?.lastAmount ?? 0) / 1e6).toFixed(2), 'pool', (poolTotal(L, x.orgId) / 1e6).toFixed(1), 'spent', (poolSpent(L, x.orgId) / 1e6).toFixed(1));
}
{
  const worst = L.orgs.map((o) => ({ o, r: (poolSpent(L, o.id) - poolTotal(L, o.id)) / poolTotal(L, o.id) })).sort((a, b) => b.r - a.r)[0];
  console.log('WORST', worst.o.abbrev, (worst.r * 100).toFixed(1) + '%', 'pool', poolTotal(L, worst.o.id), 'orig', d.pools[worst.o.id]);
  for (const x of d.picks.filter((x) => x.orgId === worst.o.id && x.round <= 12)) {
    const q = x.pid !== null ? L.players[x.pid] : null;
    console.log('   r', x.round, x.label ?? '', 'slot', (x.slot / 1e6).toFixed(2), 'signed', x.signed, 'bonus', ((q?.contract.bonus ?? 0) / 1e6).toFixed(2));
  }
}
