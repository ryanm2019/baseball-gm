// Trade finder: timing and sanity of all three modes.
import { createLeague } from '../src/core/league.ts';
import { fillNeed, findPackagesFor, shopPlayer } from '../src/core/tradeFinder.ts';
import { ovr } from '../src/core/ratings.ts';
import { activeAt } from '../src/core/util.ts';
const L = createLeague({ name: 't', userOrgIndex: 4, season: 2027 });
const name = (id: number) => { const p = L.players[id]; return `${p.last}(${ovr(p)}${p.level !== 'MLB' ? ' ' + p.level : ''})`; };
const desc = (d: ReturnType<typeof findPackagesFor>[0]) => `give [${d.prop.give[0].pids.map(name).join(', ')}${d.prop.give[0].pool ? ' pool' : ''}${d.prop.give[0].cbPicks.length ? ' CB' : ''}] get [${d.prop.give[1].pids.map(name).join(', ')}${d.prop.give[1].pool ? ` $${d.prop.give[1].pool / 1e6}M pool` : ''}${d.prop.give[1].cbPicks.length ? ' CBpick' : ''}] cost ${(d.costToYou / 1e6).toFixed(1)} value ${(d.valueToYou / 1e6).toFixed(1)}`;
const target = Object.values(L.players).filter((p) => p.orgId !== null && p.orgId !== L.userOrgId && p.level === 'MLB' && ovr(p) >= 60)[3];
let t = Date.now();
const pk = findPackagesFor(L, target.id, { untouchable: new Set(), allowPicks: true });
console.log(`GET ${name(target.id)} from ${L.orgs[target.orgId!].abbrev}: ${pk.length} packages in ${Date.now() - t}ms`); pk.forEach((d) => console.log('  ', d.note, '|', desc(d)));
const mine = activeAt(L, L.userOrgId, 'MLB').sort((a, b) => ovr(b) - ovr(a))[2];
for (const w of ['prospects', 'mlb', 'picks'] as const) {
  t = Date.now();
  const s = shopPlayer(L, mine.id, w);
  console.log(`SHOP ${name(mine.id)} for ${w}: ${s.length} offers in ${Date.now() - t}ms`); s.slice(0, 3).forEach((d) => console.log('  ', L.orgs[d.prop.orgs[1]].abbrev, desc(d)));
}
t = Date.now();
const need = fillNeed(L, 'CF', { untouchable: new Set(), allowPicks: false, maxSalary: 40e6, mlbOnly: true });
console.log(`NEED CF: ${need.length} in ${Date.now() - t}ms`); need.slice(0, 4).forEach((r) => console.log('  ', name(r.p.id), L.orgs[r.p.orgId!].abbrev, r.deal ? desc(r.deal) : 'no package'));
