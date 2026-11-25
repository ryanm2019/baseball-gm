let seed = 5 >>> 0;
Math.random = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
import { createLeague } from '../src/core/league.ts';
import { simOneDay } from '../src/core/sim/day.ts';
import { heat } from '../src/core/form.ts';
import { isPitcher } from '../src/core/ratings.ts';
const L = createLeague({ name: 'h', userOrgIndex: 3, season: 2027 });
for (const k of Object.keys(L.orgs[3].agm)) (L.orgs[3].agm as any)[k] = true;
for (let d = 0; d < 110; d++) {
  simOneDay(L);
  if (L.phase === 'regular' && [30, 60, 90].includes(L.day)) {
    const mlb = Object.values(L.players).filter((p) => p.level === 'MLB' && p.orgId !== null);
    for (const [lbl, grp] of [['hit', mlb.filter((p) => !isPitcher(p))], ['SP', mlb.filter((p) => p.pos === 'SP')], ['RP', mlb.filter((p) => p.pos === 'RP')]] as const) {
      const h = grp.map((p) => heat(L, p));
      console.log(`day ${L.day} ${lbl}: ${grp.length} players, hot ${h.filter((x) => x?.kind === 'hot').length}, cold ${h.filter((x) => x?.kind === 'cold').length}`);
    }
    const ex = mlb.map((p) => heat(L, p)).filter(Boolean).slice(0, 3).map((x) => x!.text);
    console.log('  e.g.', ex.join(' | '));
  }
}
