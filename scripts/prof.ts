import { createLeague } from '../src/core/league.ts';
import { simOneDay } from '../src/core/sim/day.ts';
import { advanceDraft } from '../src/core/draft.ts';
import * as FA from '../src/core/freeAgency.ts';
import * as IFA from '../src/core/intl.ts';
const L = createLeague({ name: 't', userOrgIndex: 28, season: 2027 });
for (const k of Object.keys(L.orgs[28].agm)) (L.orgs[28].agm as any)[k] = true;
let t = Date.now(); let n = 0;
while (L.phase !== 'offseason' && n++ < 400) { const r = simOneDay(L); if (r.stop) { console.log('STOP', L.day, r.stop); if (r.stop.includes('clock')) advanceDraft(L, true); else break; } }
console.log('season', (Date.now() - t) / 1000);
t = Date.now(); n = 0;
let fat = 0, ifat = 0;
while (L.phase === 'offseason' && n++ < 300) { simOneDay(L); const a = Date.now(); FA.faDay(L); fat += Date.now() - a; const b = Date.now(); IFA.ifaDay(L); ifat += Date.now() - b; }
console.log('offseason', (Date.now() - t) / 1000, 'days', n, 'extra faDay ms', fat, 'ifaDay ms', ifat);
