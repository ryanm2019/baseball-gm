import { createLeague } from '../src/core/league.ts';
import { simOneDay } from '../src/core/sim/day.ts';
import { advanceDraft } from '../src/core/draft.ts';
import { sumBat } from '../src/core/util.ts';
import { ovr } from '../src/core/ratings.ts';
import { orgPayroll } from '../src/core/contracts.ts';
import { dayLabel } from '../src/core/settings.ts';
const L = createLeague({ name: 't', userOrgIndex: 28, season: 2027 });
for (const k of Object.keys(L.orgs[28].agm)) (L.orgs[28].agm as any)[k] = true;
for (const s of L.staff) if (s.orgId === 28) s.exp = 2040;
const seasons = Number(process.argv[2] ?? 2);
const t0 = Date.now();
const stops: string[] = [];
let guard = 0;
const startSeason = L.season;
while ((L.season < startSeason + seasons || L.phase !== "regular") && guard++ < 3000) {
  const r = simOneDay(L);
  if (r.stop) {
    stops.push(`${dayLabel(L.season, L.day)}: ${r.stop.slice(0, 90)}`);
    if (r.stop.includes('on the clock')) advanceDraft(L, true);
  }
}
console.log("time", ((Date.now() - t0) / 1000).toFixed(1), "s; now", L.season, L.phase, dayLabel(L.season, L.day), "guard", guard);
console.log('stops:\n ' + stops.join('\n '));
const tx: Record<string, number> = {}; for (const t of L.transactions) tx[t.type] = (tx[t.type] ?? 0) + 1; console.log(tx);
const players = Object.values(L.players);
console.log('players', players.length, 'retired kept', players.filter(p => p.retired).length, 'FA', players.filter(p => p.orgId === null && !p.retired && !p.prospect && !p.ifa).length, 'prospects', players.filter(p=>p.prospect).length, 'ifa', players.filter(p=>p.ifa).length);
const bigFA = L.transactions.filter(t => t.type === 'Sign' && t.text.includes('free agent')).slice(0, 8).map(t => t.text);
console.log(bigFA);
console.log(L.news.slice(-12).map(n => n.text));
const pays = L.orgs.map(o => orgPayroll(L, o).cbt / 1e6).sort((a, b) => a - b);
console.log('CBT payrolls min/med/max', pays[0].toFixed(0), pays[15].toFixed(0), pays[29].toFixed(0));
const org = L.orgs[28]; const counts: Record<string, number> = {};
for (const p of players.filter(p => p.orgId === 28)) counts[p.level ?? 'none'] = (counts[p.level ?? 'none'] ?? 0) + 1;
console.log('user org levels', counts, '40-man', players.filter(p=>p.orgId===28 && p.on40).length);
console.log('draft', L.draft ? `${L.draft.season} done=${L.draft.done} picks=${L.draft.picks.length}` : null);
const avgOvr = (lv: string) => { const ps = players.filter(p => p.level === lv && p.orgId !== null); return (ps.reduce((t, p) => t + ovr(p), 0) / ps.length).toFixed(1) + ' n' + ps.length; };
console.log('ovr by level', ['MLB','AAA','AA','A+','A','CPX','DSL'].map(l => l + ':' + avgOvr(l)).join(' '));
import { isFreeAgent, isMinorFA } from '../src/core/freeAgency.ts';
const left = Object.values(L.players).filter(p => isFreeAgent(p) && p.fa && !isMinorFA(L, p));
console.log('ML FAs left', left.length, 'ovr>=50:', left.filter(p => ovr(p) >= 50).length, 'avg', (left.reduce((t,p)=>t+ovr(p),0)/Math.max(1,left.length)).toFixed(1));
const ml40 = L.orgs.map(o => players.filter(p => p.orgId === o.id && p.on40).length); console.log('40-man sizes', Math.min(...ml40), Math.max(...ml40));
import { fortyMan } from '../src/core/util.ts';
for (const o of L.orgs) { const f = players.filter(p => p.orgId === o.id && p.on40); if (f.length > 40) console.log('over', o.abbrev, o.id === L.userOrgId ? 'USER' : '', 'on40', f.length, 'fortyMan()', fortyMan(L, o.id).length, 'IL60', f.filter(p=>p.il?.type==='IL60').length); }
const d = (L as any).draft;
console.log('draftAdjust', JSON.stringify(L.draftAdjust), 'ifaPenalty', JSON.stringify(L.ifaPenalty));
console.log('cbPicks', L.cbPicks.map(c => `${c.season}${c.round}:${L.orgs[c.orgId].abbrev}`).join(' '));
console.log('QO news', L.news.filter(n => n.text.includes('forfeit') || n.text.includes('moved back')).map(n => n.text).slice(0, 5));
console.log('owner news', L.news.filter(n => n.text.includes('Owner review') || n.text.includes('were sold')).map(n => n.text).slice(0, 4));
console.log('cbt history over', L.cbtHistory.filter(r => r.cbt > L.settings.cbtThreshold).map(r => `${r.season} ${L.orgs[r.orgId].abbrev} $${(r.cbt/1e6).toFixed(0)}M tax $${(r.tax/1e6).toFixed(1)}M`).join(' | '));
