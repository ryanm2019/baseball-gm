// Farm director: top prospects play every day (sharing spots), rehab players play in the minors.
import { createLeague } from '../src/core/league.ts';
import { simOneDay } from '../src/core/sim/day.ts';
import { topProspects } from '../src/core/sim/lineup.ts';
import { isPitcher } from '../src/core/ratings.ts';
const L = createLeague({ name: 't', userOrgIndex: 3, season: 2027 });
const org = L.orgs[L.userOrgId];
const top = topProspects(L, org.id);
const hitters = [...top.keys()].map((id) => L.players[id]).filter((p) => !isPitcher(p) && p.level && ['AAA', 'AA', 'A+', 'A'].includes(p.level));
const starts = new Map<number, number>(); const positions = new Map<number, Set<string>>();
const lvlGames: Record<string, number> = {};
let rehabPa = 0;
for (let d = 0; d < 35; d++) {
  simOneDay(L);
  const today = L.day - 1;
  for (const lv of ['AAA', 'AA', 'A+', 'A']) if (org.lastGameDay?.[lv as 'AAA'] === today) lvlGames[lv] = (lvlGames[lv] ?? 0) + 1;
  for (const p of hitters) if (p.straightDay === today) {
    starts.set(p.id, (starts.get(p.id) ?? 0) + 1);
    const ex = Object.entries(p.posInfo?.exp ?? {}).filter(([, v]) => (v ?? 0) > 0).map(([k]) => k);
    positions.set(p.id, new Set([p.pos, ...ex]));
  }
}
for (const p of hitters.slice(0, 10)) console.log(`#${top.get(p.id)} ${p.last.padEnd(10)} ${p.pos} ${p.level}: ${starts.get(p.id) ?? 0}/${lvlGames[p.level!] ?? 0} starts | positions with experience: ${[...(positions.get(p.id) ?? [])].join(',')}`);
for (const p of Object.values(L.players)) for (const e of p.stats) if (e.season === L.season && e.level !== 'MLB' && p.level === 'MLB' && e.orgId === org.id) rehabPa += e.bat.pa + e.pit.bf;
console.log('MLB players with minor-league PA/BF this season (rehab):', rehabPa);
