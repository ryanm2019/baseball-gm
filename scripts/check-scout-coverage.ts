// Scouting coverage over a year: draft class (spring to draft), international
// class (release to signing day), internal coverage of your own system.
//   node --experimental-strip-types scripts/check-scout-coverage.ts [october-save.json]
let seed = 8 >>> 0;
Math.random = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
import { readFileSync } from 'node:fs';
import { migrate } from '../src/core/migrate.ts';
import { simOneDay } from '../src/core/sim/day.ts';
import { advanceDraft } from '../src/core/draft.ts';
import { scouting, visitsPerMonth } from '../src/core/scouting.ts';
import { dayLabel } from '../src/core/settings.ts';
import { scoutedPot } from '../src/core/ratings.ts';
import type { League } from '../src/core/types.ts';
const L = migrate(JSON.parse(readFileSync(process.argv[2] ?? '/tmp/window.json', 'utf8'))) as League;
const u = L.orgs[L.userOrgId];
console.log('migrated: user ICS', u.staff.ICS === undefined ? 'vacant' : 'hired', '| AI clubs with ICS:', L.orgs.filter((o) => o.staff.ICS !== undefined).length, '| notice:', L.inbox?.some((m) => m.subject.startsWith('New opening')));
// Hire the best free candidate.
const cand = L.staff.filter((s) => s.role === 'ICS' && s.orgId === null).sort((a, b) => b.evaluation - a.evaluation)[0];
cand.orgId = u.id; cand.exp = L.season + 3; u.staff.ICS = cand.id;
const by = (pred: (pid: number) => boolean, role: string) => Object.values(scouting(L).reports).filter((r) => r.by === role && pred(r.pid)).length;
let ifaPeak = 0, ifaRep = 0, top100Ifa = 0;
const ifaIds = new Set<number>();
let draftRep = 0, top200 = 0;
let printed = false;
for (let i = 0; i < 420; i++) {
  const r = simOneDay(L); if (r.stop?.includes('clock')) advanceDraft(L, true);
  const ifas = Object.values(L.players).filter((p) => p.ifa && !p.ifa.posted && p.orgId === null && !p.retired);
  for (const p of ifas) ifaIds.add(p.id);
  if (ifas.length > ifaPeak) ifaPeak = ifas.length;
  if (ifas.length && !L.events.includes('ifa-open')) {
    ifaRep = by((id) => ifaIds.has(id), 'INT');
    const best = [...ifas].sort((a, b) => scoutedPot(L, b) - scoutedPot(L, a)).slice(0, 100);
    top100Ifa = best.filter((p) => scouting(L).reports[p.id]).length;
  }
  if (L.phase === 'regular' && L.day === L.settings.draftDay - 1 && !printed) {
    printed = true;
    const cls = Object.values(L.players).filter((p) => p.prospect && p.orgId === null && !p.retired);
    draftRep = by((id) => !!L.players[id]?.prospect && L.players[id].orgId === null, 'AMA');
    const best = [...cls].sort((a, b) => scoutedPot(L, b) - scoutedPot(L, a)).slice(0, 200);
    top200 = best.filter((p) => scouting(L).reports[p.id]).length;
    console.log(`day before the draft (${dayLabel(L.season, L.day)}): ${draftRep} reports on the class of ${cls.length}; top 200 covered: ${top200}`);
    break;
  }
}
console.log(`international class (peak ${ifaPeak}): ${ifaRep} reports, top 100 covered: ${top100Ifa}`);
const mine = Object.values(scouting(L).reports).filter((r) => r.by === 'ICS');
console.log(`internal coverage reports filed: ${mine.length}; on players still ours: ${mine.filter((r) => L.players[r.pid]?.orgId === u.id).length}; looks/month: ${visitsPerMonth(L, 'ICS')}`);
console.log('digest:', L.inbox?.filter((m) => m.subject.startsWith('Internal coverage')).slice(-1)[0]?.text.slice(0, 200));
