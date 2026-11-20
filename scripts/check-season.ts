import { createLeague } from '../src/core/league.ts';
import { simOneDay } from '../src/core/sim/day.ts';
import { LEVELS } from '../src/core/types.ts';
import { sumBat, sumPit, activeAt, fortyMan, era } from '../src/core/util.ts';
import { isPitcher } from '../src/core/ratings.ts';
const L = createLeague({ name: 't', userOrgIndex: 28, season: 2027 });
const days = Number(process.argv[2] ?? 400);
const t0 = Date.now();
let d = 0;
for (; d < days; d++) {
  const r = simOneDay(L);
  if (r.stop) { console.log('stop:', r.stop); break; }
  if (d % 30 === 0) console.log('day', L.day, 'phase', L.phase, ((Date.now()-t0)/1000).toFixed(1)+'s');
}
console.log('simmed', d, 'days in', ((Date.now() - t0) / 1000).toFixed(1), 's');
for (const lv of LEVELS) {
  const ents = Object.values(L.players).flatMap(p => p.stats.filter(s => s.season === L.season && s.level === lv));
  const b = sumBat(ents), pt = sumPit(ents);
  const games = L.schedule.filter(g => g.level === lv && g.result && !g.playoff);
  const runs = games.reduce((s, g) => s + g.result!.hs + g.result!.as, 0);
  const obp = (b.h + b.bb + b.hbp) / (b.ab + b.bb + b.hbp + b.sf);
  const slg = (b.h + b.d + 2*b.t + 3*b.hr) / b.ab;
  console.log(lv.padEnd(4), 'G', games.length, 'R/G', (runs / games.length / 2).toFixed(2), 'AVG', (b.h/b.ab).toFixed(3), 'OBP', obp.toFixed(3), 'SLG', slg.toFixed(3),
    'K%', (b.k/b.pa*100).toFixed(1), 'BB%', (b.bb/b.pa*100).toFixed(1), 'HR/PA', (b.hr/b.pa*100).toFixed(2), 'SB', b.sb, 'CS', b.cs, 'ERA', era(pt).toFixed(2), 'P/PA', (pt.pitches/pt.bf).toFixed(2), 'SV', pt.sv, 'HLD', pt.hld, 'W', pt.w, 'L', pt.l);
}
// roster sanity for all orgs
let bad = 0;
for (const o of L.orgs) {
  const a = activeAt(L, o.id, 'MLB'); const f = fortyMan(L, o.id);
  if (a.length !== 26 && a.length !== 28 || f.length > 40) { bad++; if (bad < 5) console.log('org', o.abbrev, 'active', a.length, '40', f.length, 'P', a.filter(isPitcher).length); }
}
console.log('orgs with odd MLB/40 counts:', bad);
const st = L.standings.MLB; const rows = L.orgs.map(o => [o.abbrev, st[o.id].w, st[o.id].l]).sort((a:any,b:any)=>b[1]-a[1]);
console.log('best', rows.slice(0,3).join(' | '), 'worst', rows.slice(-3).join(' | '));
console.log('transactions', L.transactions.length, 'news', L.news.length, 'IL now', Object.values(L.players).filter(p=>p.il).length);
const types: Record<string, number> = {}; for (const t of L.transactions) types[t.type] = (types[t.type]??0)+1; console.log(types);
// top hitters MLB
const mlb = Object.values(L.players).map(p => ({p, e: p.stats.find(s => s.season===L.season && s.level==='MLB')})).filter(x=>x.e);
const hr = mlb.sort((a,b)=>b.e!.bat.hr-a.e!.bat.hr).slice(0,3).map(x=>x.p.last+' '+x.e!.bat.hr+'HR '+x.e!.bat.pa+'PA');
console.log('HR leaders', hr.join(', '));
const kl = mlb.sort((a,b)=>b.e!.pit.k-a.e!.pit.k).slice(0,3).map(x=>x.p.last+' '+x.e!.pit.k+'K '+(x.e!.pit.outs/3).toFixed(0)+'IP '+x.e!.pit.gs+'GS');
console.log('K leaders', kl.join(', '));
const sv = mlb.sort((a,b)=>b.e!.pit.sv-a.e!.pit.sv).slice(0,3).map(x=>x.p.last+' '+x.e!.pit.sv+'SV');
console.log('SV leaders', sv.join(', '));
if (L.playoffs) console.log('champion', L.playoffs.champion, L.playoffs.series.map(s=>`${s.id}:${s.wins.join('-')}`).join(' '));
const svc = Object.values(L.players).filter(p=>p.serviceThisSeason>0); console.log('players with service this season', svc.length, 'max', Math.max(...svc.map(p=>p.serviceThisSeason)));
const sp = mlb.filter(x=>x.e!.pit.gs>0).sort((a,b)=>b.e!.pit.outs-a.e!.pit.outs).slice(0,5).map(x=>`${x.p.last} ${x.e!.pit.gs}GS ${(x.e!.pit.outs/3).toFixed(0)}IP ${(x.e!.pit.er*27/x.e!.pit.outs).toFixed(2)}ERA ${(x.e!.pit.pitches/x.e!.pit.gs).toFixed(0)}P/GS`);
console.log('IP leaders', sp.join(' | '));
const allSp = mlb.filter(x=>x.e!.pit.gs>0); const gs = allSp.reduce((s,x)=>s+x.e!.pit.gs,0);
console.log('starters used', allSp.length, 'GS total', gs);
const rp = mlb.filter(x=>x.e!.pit.g>0 && x.e!.pit.gs===0).sort((a,b)=>b.e!.pit.g-a.e!.pit.g).slice(0,3).map(x=>`${x.p.last} ${x.e!.pit.g}G ${(x.e!.pit.outs/3).toFixed(0)}IP`);
console.log('app leaders', rp.join(' | '));
const bat = mlb.filter(x=>x.e!.bat.pa>=500).map(x=>x.e!.bat); console.log('qualified hitters', bat.length, 'max AVG', Math.max(...bat.map(b=>b.h/b.ab)).toFixed(3), 'min AVG', Math.min(...bat.map(b=>b.h/b.ab)).toFixed(3));
import { LEVELS as LV } from '../src/core/types.ts';
for (const lv of LV) { const ps = Object.values(L.players).filter(p=>p.level===lv && p.orgId!==null); console.log('end age', lv, (ps.reduce((s,p)=>s+L.season-p.born,0)/ps.length).toFixed(1), 'n', ps.length); }
console.log('FA pool', Object.values(L.players).filter(p=>p.orgId===null).length);
