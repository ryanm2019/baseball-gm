import { createLeague } from '../src/core/league.ts';
import { simOneDay } from '../src/core/sim/day.ts';
const L = createLeague({ name: 't', userOrgIndex: 28, season: 2027 });
const snap = () => { const ps = Object.values(L.players).filter(p=>p.level==='AAA' && p.orgId!==null); return (ps.reduce((s,p)=>s+L.season-p.born,0)/ps.length).toFixed(2); };
const before = new Map(Object.values(L.players).map(p=>[p.id, p.level]));
console.log('day0', snap());
for (let d=1; d<=60; d++) { simOneDay(L); if (d%10===0) console.log('day', d, snap()); }
// where did original AAA players go
const out: Record<string, number> = {}; const inn: Record<string, number> = {};
for (const p of Object.values(L.players)) {
  const b = before.get(p.id);
  if (b === 'AAA' && p.level !== 'AAA') { const k = (p.orgId===null?'FA':p.level)+(L.season-p.born>=26?' old':' young'); out[k]=(out[k]??0)+1; }
  if (b !== 'AAA' && p.level === 'AAA' && p.orgId!==null) { const k = (b??'new')+(L.season-p.born>=26?' old':' young'); inn[k]=(inn[k]??0)+1; }
}
console.log('left AAA', out); console.log('joined AAA', inn);
