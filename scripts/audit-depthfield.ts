// Audit: does the Field view's starting lineup match who actually plays every day?
//   node --experimental-strip-types scripts/audit-depthfield.ts [save.json]
let seed = 4 >>> 0;
Math.random = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
import { readFileSync } from 'node:fs';
import { migrate } from '../src/core/migrate.ts';
import { buildLineup, everydayLineup } from '../src/core/sim/lineup.ts';
import { activeAt } from '../src/core/util.ts';
import { isPitcher } from '../src/core/ratings.ts';
import { positionGames } from '../src/core/positions.ts';
import type { League, Player, Pos } from '../src/core/types.ts';
const L = migrate(JSON.parse(readFileSync(process.argv[2] ?? '/tmp/window.json', 'utf8'))) as League;
const gs = (p: Player) => p.stats.filter((e) => e.season === L.season && e.level === 'MLB' && e.orgId === p.orgId).reduce((t, e) => t + e.bat.gs, 0);
const oldView = (orgId: number, mode: 'saved' | 'auto') => {
  const saved = L.orgs[orgId].depth.MLB;
  if (mode === 'saved' && saved && !saved.auto) return saved.lineup.map((s) => s.pid);
  return buildLineup(L, orgId, 'MLB')?.batters.map((b) => b.p.id) ?? [];
};
let regs = 0, missOld = 0, missNew = 0;
const flicker: number[] = [];
for (const o of L.orgs) {
  const hitters = activeAt(L, o.id, 'MLB').filter((p) => !isPitcher(p) && !p.injury);
  const tg = L.standings.MLB[o.id].w + L.standings.MLB[o.id].l;
  const regulars = hitters.filter((p) => gs(p) >= Math.max(20, tg * 0.8));
  const before = new Set(oldView(o.id, 'saved'));
  const after = new Set((everydayLineup(L, o.id) ?? []).map((b) => b.p.id));
  regs += regulars.length;
  missOld += regulars.filter((p) => !before.has(p.id)).length;
  missNew += regulars.filter((p) => !after.has(p.id)).length;
  // Re-render the old auto view 10 times: how many different lineups?
  const seen = new Set<string>();
  for (let i = 0; i < 10; i++) seen.add([...oldView(o.id, 'auto')].sort().join(','));
  flicker.push(seen.size);
}
console.log(`regulars (started 80%+ of team games, healthy, active): ${regs}`);
console.log(`missing from Field view before: ${missOld}, after: ${missNew}`);
console.log(`old auto view: distinct lineups over 10 renders per club: avg ${(flicker.reduce((a, b) => a + b, 0) / flicker.length).toFixed(1)}, max ${Math.max(...flicker)}`);

// Does the new view put each regular at the spot he's actually played most?
let atMost = 0, placed = 0;
for (const o of L.orgs) {
  const lu = everydayLineup(L, o.id) ?? [];
  for (const b of lu) {
    const pg = positionGames(b.p, L.season);
    if (!pg.length || pg[0].g < 20) continue;
    placed++;
    if (pg[0].pos === b.pos) atMost++;
  }
}
console.log(`new view: starters shown at the position they've played most: ${atMost}/${placed}`);
const u = L.orgs[L.userOrgId];
console.log('user lineup:', (everydayLineup(L, u.id) ?? []).map((b) => `${b.pos} ${b.p.last} [${positionGames(b.p, L.season).map((r) => r.pos + ' ' + r.g + '/' + r.gs).join(', ')}]`).join(' | '));
