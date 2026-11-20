import { createLeague } from '../src/core/league.ts';
import { simOneDay } from '../src/core/sim/day.ts';
import { playerWar, seasonCtx, batWar, pitWar } from '../src/core/war.ts';
import { isPitcher, ovr } from '../src/core/ratings.ts';
import { ops, era, fip, ipStr } from '../src/core/util.ts';
const L = createLeague({ name: 't', userOrgIndex: 28, season: 2027 });
for (const k of Object.keys(L.orgs[28].agm)) (L.orgs[28].agm as any)[k] = true;
let g = 0;
while (L.phase === 'regular' && g++ < 400) simOneDay(L);
const ctx = seasonCtx(L, 2027);
console.log(ctx);
const rows = Object.values(L.players).map((p) => ({ p, w: playerWar(L, p, { season: 2027 }) })).filter((x) => x.w).sort((a, b) => b.w - a.w);
for (const { p, w } of [...rows.slice(0, 8), ...rows.filter(r=>isPitcher(r.p)).slice(0,5)]) {
  const e = p.stats.find((s) => s.season === 2027 && s.level === 'MLB')!;
  console.log(p.pos, p.last, w.toFixed(1), 'ovr', ovr(p).toFixed(0), isPitcher(p) ? `IP ${ipStr(e.pit.outs)} ERA ${era(e.pit).toFixed(2)} FIP ${fip(e.pit).toFixed(2)} K ${e.pit.k}` : `PA ${e.bat.pa} OPS ${ops(e.bat).toFixed(3)} HR ${e.bat.hr} SB ${e.bat.sb}`);
}
const ws = rows.map(r=>r.w); console.log('n', ws.length, '>5', ws.filter(w=>w>5).length, '>8', ws.filter(w=>w>8).length);
