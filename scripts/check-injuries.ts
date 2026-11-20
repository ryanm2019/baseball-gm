// Injury volume vs. MLB: ~30 IL placements per club per season, ~60-70 days per MLB IL stint on average.
import { createLeague } from '../src/core/league.ts';
import { simOneDay } from '../src/core/sim/day.ts';
import { advanceDraft } from '../src/core/draft.ts';
const L = createLeague({ name: 't', userOrgIndex: 3, season: 2027 });
for (const k of Object.keys(L.orgs[3].agm)) (L.orgs[3].agm as any)[k] = true;
let g = 0;
while (L.phase === 'regular' && g++ < 400) { const r = simOneDay(L); if (r.stop?.includes('clock')) advanceDraft(L, true); }
const il = L.transactions.filter((t) => t.type === 'IL');
const mlb = il.filter((t) => !t.text.includes('minor league'));
const days = (t: string) => 0;
const mlbDays = mlb.map((t) => t.text.match(/(\d+)-day/)?.[1]).reduce((a: any, x: any) => ((a[x] = (a[x] ?? 0) + 1), a), {});
console.log('MLB IL placements', mlb.length, 'per team', (mlb.length / 30).toFixed(1), mlbDays);
console.log('MiLB IL placements', il.length - mlb.length, 'per org', ((il.length - mlb.length) / 30).toFixed(1));
const news = L.news.filter((n) => n.orgId === 3 && n.text.includes('was injured'));
const lv: Record<string, number> = {}; for (const n of news) { const m = n.text.match(/\((\w\+?)\)/)?.[1] ?? '?'; lv[m] = (lv[m] ?? 0) + 1; }
console.log('user org injury news by level', lv, 'total', news.length);
void days;
