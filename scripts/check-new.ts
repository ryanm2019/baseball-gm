// Injury decisions, splits, playoff rosters, scouting focus, September call-ups.
import { createLeague } from '../src/core/league.ts';
import { simOneDay } from '../src/core/sim/day.ts';
import { answerInjury } from '../src/core/injuries.ts';
import { scoutFactor } from '../src/core/ratings.ts';
const L = createLeague({ name: 't', userOrgIndex: 3, season: 2027 });
const me = L.orgs[L.userOrgId];
let stops: string[] = [];
let injMsgs = 0; let decided = 0;
for (let d = 0; d < 230 && L.phase !== 'offseason'; d++) {
  const r = simOneDay(L);
  if (r.stop) stops.push(r.stop.slice(0, 70));
  for (const m of L.inbox ?? []) if (m.kind === 'injury' && !m.resolved) { injMsgs++; const t = answerInjury(L, m.pids[0], 'second'); const t2 = answerInjury(L, m.pids[0], decided % 2 ? 'rehab' : 'surgery'); m.resolved = 'x'; decided++; if (decided <= 2) console.log('  injury:', m.subject, '|', t, '|', t2); }
}
console.log('phase', L.phase, 'day', L.day, '| injury decisions', injMsgs, '| AI serious decisions', Object.values(L.players).filter((p) => p.injury?.decision && p.orgId !== me.id).length, '| rehabbing w/ re-injury risk', Object.values(L.players).filter((p) => p.reinjury).length);
const star = Object.values(L.players).filter((p) => p.orgId === me.id && p.level === 'MLB').sort((a, b) => b.stats.reduce((t, e) => t + e.bat.pa, 0) - a.stats.reduce((t, e) => t + e.bat.pa, 0))[0];
const sp = star.stats.find((e) => e.season === L.season && e.level === 'MLB')?.splits?.bat ?? {};
console.log('splits for', star.last, Object.entries(sp).map(([k, v]) => `${k}:${v.pa}`).join(' '));
console.log('stops:', [...new Set(stops)].slice(0, 12).join(' || '));
console.log('playoff rosters set:', Object.keys(L.playoffs?.rosters ?? {}).length, '| sizes', [...new Set(Object.values(L.playoffs?.rosters ?? {}).map((x) => x.length))].join(','));
const pro = Object.values(L.players).find((p) => p.orgId === 5 && p.level === 'MLB')!;
const f0 = scoutFactor(L, me, 'pro', pro); me.scoutFocus = { PRO: 'org:5' }; const f1 = scoutFactor(L, me, 'pro', pro);
const other = Object.values(L.players).find((p) => p.orgId === 7 && p.level === 'MLB')!;
console.log('scout focus on org 5: error factor', f0.toFixed(2), '->', f1.toFixed(2), '| other org player', scoutFactor(L, me, 'pro', other).toFixed(2));
console.log('september inbox:', (L.inbox ?? []).filter((m) => m.kind === 'september').map((m) => m.text.slice(0, 90)).join(''));
