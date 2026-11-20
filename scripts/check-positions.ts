// Position changes, stretch-outs, bullpen games, catcher rest, AI moves.
import { createLeague } from '../src/core/league.ts';
import { simOneDay } from '../src/core/sim/day.ts';
import { changePosition, positionReads, ovrAt } from '../src/core/positions.ts';
import { activeAt } from '../src/core/util.ts';
import { ovr, posExp, aptitude, adaptCap } from '../src/core/ratings.ts';
import type { FieldPos } from '../src/core/types.ts';
const L = createLeague({ name: 't', userOrgIndex: 6, season: 2027 });
const me = L.orgs[L.userOrgId];
const mlb = activeAt(L, me.id, 'MLB');
// 1. Hitters moved: different players, different outcomes.
const movers = Object.values(L.players).filter((p) => p.orgId !== null && p.orgId !== me.id && p.level === 'MLB' && (p.pos === 'LF' || p.pos === 'RF')).slice(0, 6);
const before = movers.map((p) => ({ p, o: ovr(p), read: positionReads(L, me, p).find((r) => r.pos === 'CF')!.fit }));
for (const p of movers) changePosition(L, p, 'CF');
const after0 = movers.map((p) => ovr(p));
// Simulate experience: 60 games at CF.
for (const p of movers) { for (let g = 0; g < 60; g++) { p.posInfo!.exp.CF = Math.min(100, (p.posInfo!.exp.CF ?? posExp(p, 'CF')) + 2.2 * 1); } }
before.forEach((b, i) => console.log(`${b.p.last.padEnd(10)} corner OF ${b.o.toFixed(1)} -> CF day 1 ${after0[i].toFixed(1)} -> after 60 games ${ovr(b.p).toFixed(1)} | scouts: ${b.read} | hidden apt ${aptitude(b.p, 'CF' as FieldPos).toFixed(1)} cap ${adaptCap(b.p, 'CF')}`));
// 2. Reliever to starter: stretched out.
const rp = mlb.filter((p) => p.pos === 'RP').sort((a, b) => b.ratings.pit.stamina - a.ratings.pit.stamina)[0];
console.log('RP->SP:', changePosition(L, rp, 'SP'), 'limit', rp.stretch?.limit);
me.depth.MLB = { auto: false, lineup: [], closer: null, setup: [], rotation: [] };
me.depth.MLB.rotation = [...activeAt(L, me.id, 'MLB').filter((p) => p.pos === 'SP' && p.id !== rp.id).slice(0, 3).map((p) => p.id), rp.id];
me.depth.MLB.bullpenDays = [4];
me.agm.depth = false;
const cs = activeAt(L, me.id, 'MLB').filter((p) => p.pos === 'C');
let cStarts: Record<number, number> = {};
const starts: number[] = [];
let bullpenGames = 0;
const trail: string[] = [];
for (let d = 0; d < 40; d++) {
  simOneDay(L);
  const c0 = cs.sort((a, b) => ovr(b) - ovr(a))[0]; trail.push(String(c0.straightDay === L.day - 1 ? c0.straight : 0));
  for (const b of Object.values(L.boxScores)) {
    if (b.day !== L.day - 1 || b.level !== 'MLB' || (b.home !== me.id && b.away !== me.id)) continue;
    const side = b.home === me.id ? 'home' : 'away';
    const sp = b.pit[side][0];
    if (sp.pid === rp.id) starts.push(sp.pitches);
    else if (L.players[sp.pid].pos === 'RP' && sp.outs <= 7) { bullpenGames++; if (bullpenGames === 1) console.log('bullpen game:', b.pit[side].map((x) => `${L.players[x.pid].last}(${L.players[x.pid].pos}) ${Math.floor(x.outs / 3)}.${x.outs % 3}IP ${x.pitches}p`).join(', ')); }
    for (const x of b.bat[side]) if (L.players[x.pid]?.pos === 'C' && x.pos === 'C') cStarts[x.pid] = (cStarts[x.pid] ?? 0) + 1;
  }
}
console.log('converted RP start pitch counts:', starts.join(', '), '| stretch now', rp.stretch?.limit ?? 'done');
console.log('bullpen games in 40 days:', bullpenGames);
console.log('starting C streak by day:', trail.join(' '));
console.log('catcher starts:', Object.entries(cStarts).map(([id, n]) => `${L.players[+id].last} ${n}`).join(', '), '| catchers on roster', cs.length);
const pos = L.transactions.filter((t) => t.type === 'Position');
console.log('AI position moves so far:', pos.length); const kinds: Record<string, number> = {}; for (const t of pos) { const m = t.text.match(/from (\w+) to (\w+)/); if (m) kinds[m[1] + '>' + m[2]] = (kinds[m[1] + '>' + m[2]] ?? 0) + 1; } console.log(JSON.stringify(kinds));
console.log('teams with <2 C:', L.orgs.filter((o) => activeAt(L, o.id, 'MLB').filter((p) => p.pos === 'C').length < 2).length, '| inbox position ideas:', (L.inbox ?? []).filter((m) => m.kind === 'position').length);
void ovrAt;
