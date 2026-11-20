// Star counts (displayed overall), relievers vs everyone, and the top of draft classes.
import { createLeague } from '../src/core/league.ts';
import { ovr, potOvr, isPitcher, displayOvr } from '../src/core/ratings.ts';
import { generateDraftClass } from '../src/core/draft.ts';
const L = createLeague({ name: 't', userOrgIndex: 3, season: 2027 });
const mlb = Object.values(L.players).filter((p) => p.level === 'MLB');
const d = (p: (typeof mlb)[0]) => displayOvr(p, ovr(p));
const cnt = (ps: typeof mlb) => [70, 65, 60].map((t) => `${t}+ ${ps.filter((p) => d(p) >= t).length}`).join(', ');
console.log('MLB', mlb.length, '| hitters', cnt(mlb.filter((p) => !isPitcher(p))), '| SP', cnt(mlb.filter((p) => p.pos === 'SP')), '| RP', cnt(mlb.filter((p) => p.pos === 'RP')));
console.log('top 10:', [...mlb].sort((a, b) => d(b) - d(a)).slice(0, 10).map((p) => `${p.pos} ${d(p).toFixed(0)}`).join(', '));
const perTeam = L.orgs.map((o) => mlb.filter((p) => p.orgId === o.id && d(p) >= 60).length);
console.log('60+ per team: min', Math.min(...perTeam), 'max', Math.max(...perTeam), 'avg', (perTeam.reduce((a, b) => a + b, 0) / 30).toFixed(1));
for (let k = 0; k < 6; k++) {
  for (const p of Object.values(L.players)) if (p.prospect) delete L.players[p.id];
  generateDraftClass(L, 2027);
  const dc = Object.values(L.players).filter((p) => p.prospect).sort((a, b) => potOvr(b) - potOvr(a));
  console.log('class', k, 'top pot', dc.slice(0, 6).map((p) => `${displayOvr(p, potOvr(p)).toFixed(0)}${p.prospect!.college ? 'c' : 'h'}`).join(' '), '| 70+:', dc.filter((p) => displayOvr(p, potOvr(p)) >= 70).length);
}
