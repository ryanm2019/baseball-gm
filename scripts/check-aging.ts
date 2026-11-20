// Aging curve: average change in true overall over one year, by age; plus star counts and draft-class talent.
import { createLeague } from '../src/core/league.ts';
import { simOneDay } from '../src/core/sim/day.ts';
import { advanceDraft } from '../src/core/draft.ts';
import { ovr, potOvr, isPitcher } from '../src/core/ratings.ts';
const L = createLeague({ name: 't', userOrgIndex: 3, season: 2027 });
for (const k of Object.keys(L.orgs[3].agm)) (L.orgs[3].agm as any)[k] = true;
for (const s of L.staff) if (s.orgId === 3) s.exp = 2040;
const mlb = Object.values(L.players).filter((p) => p.level === 'MLB');
const top = (ps: typeof mlb) => [70, 65, 60].map((t) => `${t}+: ${ps.filter((p) => ovr(p) >= t).length}`).join(', ');
console.log('MLB players', mlb.length, 'hitters', top(mlb.filter((p) => !isPitcher(p))), '| pitchers', top(mlb.filter(isPitcher)));
console.log('best 5', [...mlb].sort((a, b) => ovr(b) - ovr(a)).slice(0, 5).map((p) => `${p.pos} age ${L.season - p.born} ${ovr(p).toFixed(0)}`).join(' | '));
const dc = Object.values(L.players).filter((p) => p.prospect).sort((a, b) => potOvr(b) - potOvr(a));
console.log('draft class', dc.length, 'top-10 pot', dc.slice(0, 10).map((p) => potOvr(p).toFixed(0)).join(' '), '| pot 60+:', dc.filter((p) => potOvr(p) >= 60).length, '55+:', dc.filter((p) => potOvr(p) >= 55).length);
const before = new Map(Object.values(L.players).filter((p) => p.orgId !== null && !p.prospect).map((p) => [p.id, { o: ovr(p), a: L.season - p.born }]));
const s0 = L.season;
let g = 0;
while (!(L.season === s0 + 1 && L.phase === 'regular') && g++ < 800) { const r = simOneDay(L); if (r.stop?.includes('clock')) advanceDraft(L, true); }
const buckets: Record<string, number[]> = {};
for (const [id, b] of before) {
  const p = L.players[id];
  if (!p || p.retired) continue;
  const k = b.a <= 20 ? '<=20' : b.a <= 23 ? '21-23' : b.a <= 26 ? '24-26' : b.a <= 29 ? '27-29' : b.a <= 31 ? '30-31' : b.a <= 33 ? '32-33' : b.a <= 35 ? '34-35' : '36+';
  (buckets[k] ??= []).push(ovr(p) - b.o);
}
for (const k of ['<=20', '21-23', '24-26', '27-29', '30-31', '32-33', '34-35', '36+']) {
  const v = buckets[k] ?? [];
  console.log(k.padEnd(6), 'n', String(v.length).padStart(5), 'avg change', (v.reduce((t, x) => t + x, 0) / Math.max(1, v.length)).toFixed(2));
}
