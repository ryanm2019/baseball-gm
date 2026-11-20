import { createLeague } from '../src/core/league.ts';
import { buildLineup } from '../src/core/sim/lineup.ts';
import { simGame } from '../src/core/sim/game.ts';
const L = createLeague({ name: 't', userOrgIndex: 28, season: 2027 });
const h = buildLineup(L, 0, 'MLB')!, a = buildLineup(L, 1, 'MLB')!;
console.log('bullpen sizes', h.bullpen.length, a.bullpen.length, 'sp stamina', h.sp.ratings.pit.stamina.toFixed(0));
for (let i = 0; i < 3; i++) {
  const o = simGame(h, a, { gid: 1, day: 10 + i * 7, injuryRate: 1, ghostRunner: true });
  console.log('score', o.awayRuns, '-', o.homeRuns, 'inn', o.innings);
  for (const side of ['away', 'home'] as const) console.log(' ', side, o.box.pit[side].map(p => `${L.players[p.pid].last}:${Math.floor(p.outs/3)}.${p.outs%3}ip/${p.pitches}p ${p.dec}`).join(', '));
}
