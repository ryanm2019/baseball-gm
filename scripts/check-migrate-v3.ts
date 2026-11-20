import { readFileSync } from 'fs';
import { migrate } from '../src/core/migrate.ts';
import { simOneDay } from '../src/core/sim/day.ts';
import { advanceDraft } from '../src/core/draft.ts';
const L = migrate(JSON.parse(readFileSync('/tmp/v3.json', 'utf8')));
console.log('migrated v', L.version, 'staff', L.staff.length, 'user agm', JSON.stringify(L.orgs[L.userOrgId].agm).slice(0, 60));
let n = 0, stops = 0;
while (!(L.season === 2028 && L.phase === 'regular') && n++ < 900) { const r = simOneDay(L); if (r.stop) { stops++; if (r.stop.includes('clock')) advanceDraft(L, true); } }
console.log('reached', L.season, L.phase, 'stops', stops, 'iterations', n);
