import { createLeague } from '../src/core/league.ts';
import { ovr, potOvr, isPitcher } from '../src/core/ratings.ts';
import { LEVELS } from '../src/core/types.ts';
import { orgPayroll, cbtTax, fmtMoney } from '../src/core/contracts.ts';
const t0 = Date.now();
const L = createLeague({ name: 't', userOrgIndex: 28, season: 2027 });
console.log('created in', Date.now() - t0, 'ms; players', Object.keys(L.players).length, 'games', L.schedule.length);
for (const lv of LEVELS) {
  const ps = Object.values(L.players).filter(p => p.level === lv);
  const o = ps.map(ovr), po = ps.map(potOvr);
  const m = (a: number[]) => (a.reduce((s, x) => s + x, 0) / a.length).toFixed(1);
  const ages = ps.map(p => L.season - p.born);
  const games = L.schedule.filter(g => g.level === lv);
  const perTeam = games.length * 2 / 30;
  const lastDay = Math.max(...games.map(g => g.day));
  console.log(lv, 'n', ps.length, 'ovr', m(o), 'pot', m(po), 'age', m(ages), 'maxOvr', Math.max(...o).toFixed(1), 'maxPot', Math.max(...po).toFixed(1), 'games/team', perTeam, 'lastDay', lastDay);
}
const pays = L.orgs.map(o => orgPayroll(L, o).cbt).sort((a,b)=>a-b);
console.log('CBT payroll min/med/max', fmtMoney(pays[0]), fmtMoney(pays[15]), fmtMoney(pays[29]));
console.log('tax at 300M first-time:', fmtMoney(cbtTax(300e6, 0, L.settings).tax));
// home games balance
const home: Record<number, number> = {};
for (const g of L.schedule.filter(g=>g.level==='MLB')) home[g.home] = (home[g.home]??0)+1;
console.log('MLB home games range', Math.min(...Object.values(home)), Math.max(...Object.values(home)));
// div game counts for org 0
const div = L.schedule.filter(g=>g.level==='MLB' && (g.home===0||g.away===0));
const opp: Record<number, number> = {}; for (const g of div) { const o = g.home===0?g.away:g.home; opp[o]=(opp[o]??0)+1; }
console.log('org0 vs opponents', JSON.stringify(opp));
