// Extension sanity check: asks by career stage, the meter, signing, CBT AAV.
import { createLeague } from '../src/core/league.ts';
import { extAsk, extRefusal, extWillingness, offerExtension, extYears } from '../src/core/extensions.ts';
import { describeContract, shapeSchedule } from '../src/core/terms.ts';
import { orgPlayers } from '../src/core/util.ts';
import { ovr, potOvr } from '../src/core/ratings.ts';
import { serviceYears, orgPayroll } from '../src/core/contracts.ts';
const L = createLeague({ name: 't', userOrgIndex: 3, season: 2027 });
const me = L.orgs[L.userOrgId];
const ps = orgPlayers(L, me.id).filter((p) => p.contract.type === 'ML' && p.on40).sort((a, b) => ovr(b) - ovr(a)).slice(0, 10);
for (const p of ps) {
  const svc = serviceYears(p.mlServiceDays, L.settings);
  const years = Math.max(2, Math.min(8, 6 - Math.floor(svc) + 2));
  const a = extAsk(L, p, years);
  console.log(`${p.last.padEnd(12)} ${p.pos} age ${L.season - p.born} ovr ${ovr(p)}/${potOvr(p)} svc ${svc.toFixed(3)} | ${years}y ask $${(a.total / 1e6).toFixed(1)}M (${(a.total / years / 1e6).toFixed(1)}M/yr) ${a.byYear.map((y) => y.status).join(',')} | refuse: ${extRefusal(L, p) ?? '-'}`);
}
const p = ps.find((x) => !extRefusal(L, x))!;
const yrs = 6;
const ask = extAsk(L, p, yrs).total;
for (const f of [0.8, 0.95, 1.0, 1.05, 1.15]) console.log(`offer ${f}x meter ${extWillingness(L, p, { sched: shapeSchedule(ask * f, yrs, 'ramp') }).toFixed(2)}`);
console.log('years', extYears(L, p, yrs).map((y) => `${y.season} ${y.status} ${(y.fair / 1e6).toFixed(1)}`).join(' | '));
const before = orgPayroll(L, me).cbt;
let r = offerExtension(L, p, { sched: shapeSchedule(ask * 1.12, yrs, 'back'), option: { type: 'club', season: 0, salary: 25e6, buyout: 2e6 }, optOuts: [3], ntc: 'full', deferPct: 0.2 });
console.log(r.text);
if (r.ok) console.log(describeContract(L, p.contract), '| CBT before/after', (before / 1e6).toFixed(1), (orgPayroll(L, me).cbt / 1e6).toFixed(1), '| salary now', p.contract.salary, '| deferred rows', (me.deferred ?? []).length);
r = offerExtension(L, p, { sched: shapeSchedule(ask, yrs, 'flat') });
console.log('second offer same week:', r.text);
