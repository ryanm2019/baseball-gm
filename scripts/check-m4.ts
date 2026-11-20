// Milestone 4: trade timing, AI offers, stances, owner goals, scouts, WAR and the move log.
import { createLeague } from '../src/core/league.ts';
import { simOneDay } from '../src/core/sim/day.ts';
import { advanceDraft } from '../src/core/draft.ts';
import { dayLabel, dayToDate } from '../src/core/settings.ts';
import { playerWar } from '../src/core/war.ts';
import { isPitcher } from '../src/core/ratings.ts';
import { teamNeeds } from '../src/core/market.ts';
const L = createLeague({ name: 't', userOrgIndex: 28, season: 2027 });
const user = L.orgs[28];
for (const k of Object.keys(user.agm)) (user.agm as any)[k] = true;
user.agm.trades = false;
for (const s of L.staff) if (s.orgId === 28) s.exp = 2040;
user.interest.pos = ['C'];
const seasons = Number(process.argv[2] ?? 2);
const t0 = Date.now();
const stops: string[] = [];
const offerDays: string[] = [];
let guard = 0;
const startSeason = L.season;
let offersSeen = new Set<number>();
while ((L.season < startSeason + seasons || L.phase !== 'regular') && guard++ < 3000) {
  const r = simOneDay(L);
  for (const o of L.tradeOffers) if (!offersSeen.has(o.id)) { offersSeen.add(o.id); offerDays.push(`${dayLabel(L.season, L.day)} ${L.orgs[o.fromOrg].abbrev}: ${o.note}`); }
  if (r.stop) {
    stops.push(`${dayLabel(L.season, L.day)}: ${r.stop.slice(0, 200)}`);
    if (r.stop.includes('on the clock')) advanceDraft(L, true);
  }
  // decline offers so new ones can come
  if (L.tradeOffers.length >= 3) L.tradeOffers.splice(0, 1);
}
console.log('time', ((Date.now() - t0) / 1000).toFixed(1), 's; now', L.season, L.phase, dayLabel(L.season, L.day));
console.log('stops:\n ' + stops.join('\n '));
// trades by month
const byMonth: Record<string, number> = {};
for (const m of L.moves.filter((m) => m.type === 'Trade')) {
  const d = dayToDate(m.season, m.day);
  const k = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  byMonth[k] = (byMonth[k] ?? 0) + 1;
}
console.log('trades by month', byMonth);
const types: Record<string, number> = {}; for (const m of L.moves) types[m.type] = (types[m.type] ?? 0) + 1; console.log('moves', types);
console.log('offers to user:', offerDays.length); console.log(offerDays.slice(0, 12).join('\n'));
// WAR calibration for the last complete season
for (let s = startSeason; s < L.season; s++) {
  let hit = 0, pit = 0;
  const rows: { n: string; w: number }[] = [];
  for (const p of Object.values(L.players)) {
    const w = playerWar(L, p, { season: s });
    if (!w) continue;
    if (isPitcher(p)) pit += w; else hit += w;
    rows.push({ n: `${p.first} ${p.last} ${p.pos}`, w });
  }
  rows.sort((a, b) => b.w - a.w);
  console.log(s, 'WAR hitters', hit.toFixed(0), 'pitchers', pit.toFixed(0), 'top', rows.slice(0, 5).map((r) => `${r.n} ${r.w.toFixed(1)}`).join(', '), 'bottom', rows.slice(-2).map((r) => `${r.n} ${r.w.toFixed(1)}`).join(', '));
}
console.log('stances', L.orgs.map((o) => `${o.abbrev}:${o.strategy[0]}/${o.stance}`).join(' '));
console.log('blocks', L.orgs.reduce((t, o) => t + o.block.length, 0), 'needs sample', L.orgs.slice(0, 5).map((o) => `${o.abbrev}:${teamNeeds(L, o.id).join('/')}`).join(' '));
console.log('goals', JSON.stringify(user.goals));
console.log(L.news.filter((n) => n.orgId === 28 && /Owner|goals/.test(n.text)).map((n) => n.text).join('\n'));
