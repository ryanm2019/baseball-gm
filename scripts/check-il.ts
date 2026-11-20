import { createLeague } from '../src/core/league.ts';
import { simOneDay } from '../src/core/sim/day.ts';
import { activeAt, fortyMan, orgPlayers } from '../src/core/util.ts';
const idx = 26; // try a few orgs
const L = createLeague({ name: 't', userOrgIndex: idx, season: 2027 });
console.log('user', L.orgs[idx].abbrev, 'agm', JSON.stringify(L.orgs[idx].agm));
for (let d = 0; d < 40; d++) {
  const before = L.transactions.length;
  const r = simOneDay(L);
  const tx = L.transactions.slice(before).filter((t) => t.orgId === idx);
  const il = orgPlayers(L, idx).filter((p) => p.il && p.il.returnLevel === 'MLB');
  if (tx.some((t) => t.type === 'IL' || t.type === 'Recall' || t.type === 'Select') || r.stop) {
    console.log('day', L.day - 1, 'active', activeAt(L, idx, 'MLB').length, '40-man', fortyMan(L, idx).length, 'MLB IL', il.map((p) => `${p.last}:${p.il!.type}`).join(','), 'stop:', r.stop?.slice(0, 80));
    for (const t of tx) console.log('   ', t.type, t.text);
  }
}
console.log(L.news.filter(n=>n.orgId===idx && n.text.startsWith("Assistant")).slice(0,3).map(n=>n.text).join("\n"));
