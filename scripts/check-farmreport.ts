import { createLeague } from '../src/core/league.ts';
import { simOneDay } from '../src/core/sim/day.ts';
const L = createLeague({ name: 't', userOrgIndex: 3, season: 2027 });
for (let i = 0; i < 100; i++) simOneDay(L);
const r = L.farmReports ?? [];
console.log('reports', r.length);
for (const last of r.slice(-5)) { console.log("=== day", last.day);
for (const s of last.sections) { console.log('##', s.title); for (const l of s.lines) console.log('  ', l.text); }
}
console.log(L.news.filter((n) => n.text.includes('weekly report')).slice(-2).map((n) => n.text));
