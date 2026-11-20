// Reliever usage by role over a season.
import { createLeague } from '../src/core/league.ts';
import { simOneDay } from '../src/core/sim/day.ts';
import { advanceDraft } from '../src/core/draft.ts';
import { buildLineup } from '../src/core/sim/lineup.ts';
import { ipStr } from '../src/core/util.ts';
const L = createLeague({ name: 't', userOrgIndex: 3, season: 2027 });
for (const k of Object.keys(L.orgs[3].agm)) (L.orgs[3].agm as any)[k] = true;
let g = 0;
while (L.phase === 'regular' && g++ < 400) { const r = simOneDay(L); if (r.stop?.includes('clock')) advanceDraft(L, true); }
for (const oid of [0, 7]) {
  const lu = buildLineup(L, oid, 'MLB')!;
  console.log(L.orgs[oid].abbrev);
  for (const p of lu.bullpen) {
    const e = p.stats.filter((s) => s.season === L.season && s.level === 'MLB').reduce((t, s) => ({ g: t.g + s.pit.g, sv: t.sv + s.pit.sv, hld: t.hld + s.pit.hld, outs: t.outs + s.pit.outs, gs: t.gs + s.pit.gs }), { g: 0, sv: 0, hld: 0, outs: 0, gs: 0 });
    console.log('  ', (lu.roles.get(p.id) ?? '').padEnd(3), p.last.padEnd(12), 'G', e.g, 'GS', e.gs, 'SV', e.sv, 'HLD', e.hld, 'IP', ipStr(e.outs), 'IP/G', (e.outs / 3 / Math.max(1, e.g - e.gs)).toFixed(2));
  }
}
