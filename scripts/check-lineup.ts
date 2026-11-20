// A manual lineup survives an injury: only the injured player's spot is subbed.
import { createLeague } from '../src/core/league.ts';
import { buildLineup } from '../src/core/sim/lineup.ts';
import { simOneDay } from '../src/core/sim/day.ts';
const L = createLeague({ name: 't', userOrgIndex: 5, season: 2027 });
const org = L.orgs[5];
org.agm.depth = false;
const auto = buildLineup(L, 5, 'MLB')!;
const lineup = [...auto.batters].reverse().map((b) => ({ pid: b.p.id, pos: b.pos }));
org.depth.MLB = { auto: false, lineup, rotation: [], closer: null, setup: [] };
const hurt = L.players[lineup[3].pid];
hurt.injury = { name: 'test', daysLeft: 5, totalDays: 5 };
const lu = buildLineup(L, 5, 'MLB')!;
const kept = lu.batters.filter((b, i) => b.p.id === lineup[i].pid).length;
console.log('kept', kept, 'of 9; spot 4 now', lu.batters[3].p.last, lu.batters[3].pos, '(was', hurt.last, lineup[3].pos + ')');
let stops = 0;
for (let i = 0; i < 10; i++) if (simOneDay(L).stop) stops++;
console.log('after 10 days: manual still', org.depth.MLB!.auto === false, 'stops', stops, 'healed', !hurt.injury);
