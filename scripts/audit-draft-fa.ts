// Draft, free agency and AI trade offer audit over several seasons.
//   node --experimental-strip-types scripts/audit-draft-fa.ts [seasons=6] [seed=3]
let seed = Number(process.argv[3] ?? 3) >>> 0;
Math.random = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
import { createLeague } from '../src/core/league.ts';
import { simOneDay } from '../src/core/sim/day.ts';
import { advanceDraft } from '../src/core/draft.ts';
import { ovr, potOvr } from '../src/core/ratings.ts';
import { playerWar } from '../src/core/war.ts';
import { serviceYears } from '../src/core/contracts.ts';
import type { League, Player } from '../src/core/types.ts';

const SEASONS = Number(process.argv[2] ?? 6);
const L: League = createLeague({ name: 'draftfa', userOrgIndex: 3, season: 2027 });
const U = L.orgs[3];
for (const k of Object.keys(U.agm)) (U.agm as Record<string, boolean>)[k] = true;
(U.agm as Record<string, boolean>).trades = false;
const S0 = L.season;
const pct = (a: number, b: number) => `${b ? Math.round((100 * a) / b) : 0}%`;
const kind = (p: Player) => (p.pos === 'SP' ? 'SP' : p.pos === 'RP' ? 'RP' : 'H');

interface Pick { pid: number; season: number; overall: number; round: number; college: boolean; pos: string; pot: number; ovr: number }
const picks: Pick[] = [];
const faSeen = new Set<number>();
const draftDone = new Set<number>(), faDone = new Set<number>(), seenOffers = new Set<number>();
const offerPos: Record<string, number> = {}, wantPos: Record<string, number> = {};
let offers = 0;

function draftReport() {
  const d = L.draft!;
  const ps = d.picks.filter((p) => p.pid != null).map((pk) => { const p = L.players[pk.pid!]; return { pid: p.id, season: L.season, overall: pk.pick, round: pk.round, college: L.season - p.born >= 20, // (signing clears his prospect info)
 pos: kind(p), pot: potOvr(p), ovr: ovr(p) }; });
  picks.push(...ps);
  const r1 = ps.filter((p) => p.overall <= 30), top10 = ps.filter((p) => p.overall <= 10);
  const cls = Object.values(L.players).filter((p) => p.prospect?.year === L.season);
  const topPot = [...cls].sort((a, b) => potOvr(b) - potOvr(a)).slice(0, 30);
  console.log(`\n=== ${L.season} draft: ${cls.length} prospects ===`);
  console.log(`top 10 picks college ${pct(top10.filter((p) => p.college).length, 10)}; 1st round college ${pct(r1.filter((p) => p.college).length, r1.length)} (real MLB lately ~60-70%)`);
  console.log(`class top-30 by potential: college ${pct(topPot.filter((p) => p.prospect!.college).length, 30)}; mean pot HS ${(topPot.filter((p) => !p.prospect!.college).reduce((t, p) => t + potOvr(p), 0) / Math.max(1, topPot.filter((p) => !p.prospect!.college).length)).toFixed(1)} vs college ${(topPot.filter((p) => p.prospect!.college).reduce((t, p) => t + potOvr(p), 0) / Math.max(1, topPot.filter((p) => p.prospect!.college).length)).toFixed(1)}`);
  console.log(`1st round by type: ${['H', 'SP', 'RP'].map((k) => `${k} ${r1.filter((p) => p.pos === k).length}`).join(', ')}`);
  const rp = ps.filter((p) => p.pos === 'RP').sort((a, b) => b.pot - a.pot).slice(0, 5);
  console.log(`best RP prospects (pot/ovr → pick #): ${rp.map((p) => `${p.pot.toFixed(0)}/${p.ovr.toFixed(0)}${p.college ? 'c' : 'hs'} #${p.overall}`).join(', ')}`);
  const clsRp = cls.filter((p) => p.pos === 'RP');
  console.log(`RPs in class ${clsRp.length}/${cls.length}; best RP pot ${Math.max(...clsRp.map(potOvr)).toFixed(0)}, best SP pot ${Math.max(...cls.filter((p) => p.pos === 'SP').map(potOvr)).toFixed(0)}`);
  console.log(`1st-rounders: ${r1.slice(0, 12).map((p) => `${p.pos}${p.college ? 'c' : 'hs'} ${p.ovr.toFixed(0)}/${p.pot.toFixed(0)}`).join(' · ')}`);
}

function faReport() {
  // Everyone who reached the market this winter, signed yet or not.
  const pool = [...faSeen].map((id) => L.players[id]).filter((p) => p && !p.retired);
  const top = [...pool].sort((a, b) => ovr(b) - ovr(a));
  const mlbTop = Object.values(L.players).filter((p) => p.orgId !== null && p.level === 'MLB').map(ovr).sort((a, b) => b - a);
  console.log(`\n=== ${L.season} free agent class (opens day ${L.day}) — ${pool.length} players ===`);
  console.log(`top 10 ovr: ${top.slice(0, 10).map((p) => `${p.last} ${p.pos} ${L.season + 1 - p.born}y ${ovr(p).toFixed(0)}`).join(', ')}`);
  console.log(`signed already (of 55+): ${top.filter((p) => ovr(p) >= 55 && p.orgId !== null).length}`);
  console.log(`60+ ${top.filter((p) => ovr(p) >= 60).length}, 55+ ${top.filter((p) => ovr(p) >= 55).length}, 50+ ${top.filter((p) => ovr(p) >= 50).length} | for scale, MLB 30th best ${mlbTop[29].toFixed(0)}, 100th ${mlbTop[99].toFixed(0)}, 300th ${mlbTop[299].toFixed(0)}`);
}

// Who was headed to free agency at the start of the season, and what happened to them.
let pending: Player[] = [];
function pendingSnap() {
  pending = Object.values(L.players).filter((p) => p.orgId !== null && p.level === 'MLB' && p.contract.type === 'ML' && p.contract.exp === L.season && serviceYears(p.mlServiceDays, L.settings) >= 5).sort((a, b) => ovr(b) - ovr(a)).slice(0, 25);
}
function pendingReport() {
  const out: Record<string, number> = {};
  for (const p of pending) {
    const k = p.retired ? 'retired' : p.orgId === null ? 'free agent' : p.contract.exp > L.season ? (p.orgId === p.stats.at(-1)?.orgId ? 'extended/re-signed' : 'moved & extended') : 'other';
    out[k] = (out[k] ?? 0) + 1;
  }
  console.log(`top 25 players headed to free agency at the start of ${L.season} (ovr ${pending[0] ? ovr(pending[0]).toFixed(0) : '-'}…${pending.at(-1) ? ovr(pending.at(-1)!).toFixed(0) : '-'}): ${JSON.stringify(out)}`);
}

let guard = 0;
pendingSnap();
while (L.season < S0 + SEASONS && guard++ < 400 * SEASONS) {
  // Keep the user's staff (and so the assistant GM) under contract.
  for (const st of L.staff) if (st.orgId === U.id && st.exp <= L.season) st.exp = L.season + 2;
  const r = simOneDay(L);
  if (r.stop?.includes('clock')) advanceDraft(L, true);
  if (L.draft?.done && !draftDone.has(L.season)) { draftDone.add(L.season); draftReport(); }
  if (L.phase === 'offseason') for (const p of Object.values(L.players)) if (p.fa && p.orgId === null && !p.prospect && !p.ifa) faSeen.add(p.id);
  if (L.phase === 'preseason') faSeen.clear();
  // Twenty days after the market opens (so qualifying-offer decliners are in it).
  if (L.phase === 'offseason' && !faDone.has(L.season) && Object.values(L.players).some((p) => p.fa && p.orgId === null && p.fa.opened === L.day - 20)) {
    faDone.add(L.season); pendingReport(); faReport();
  }
  if (L.phase === 'preseason' && pending.length && pending[0].contract.exp < L.season) pendingSnap();
  for (const o of L.tradeOffers) {
    if (seenOffers.has(o.id)) continue;
    seenOffers.add(o.id); offers++;
    for (const id of o.proposal.give[0].pids) { const p = L.players[id]; const k = `${kind(p)} ${p.level === 'MLB' ? 'MLB' : 'minors'}`; offerPos[k] = (offerPos[k] ?? 0) + 1; }
    for (const id of o.proposal.give[1].pids) { const p = L.players[id]; const k = `${kind(p)} ${p.level === 'MLB' ? 'MLB' : 'minors'}`; wantPos[k] = (wantPos[k] ?? 0) + 1; }
  }
}

console.log(`relievers moved to the rotation by their clubs: ${L.transactions.filter((t) => t.text.includes("built up a starter's stamina")).length}`);
console.log(`\nsimmed to ${L.season} ${L.phase} day ${L.day}`);
console.log(`\n=== AI trade offers to you: ${offers} offers ===`);
console.log('players they offer:', offerPos);
console.log('players they ask for:', wantPos);
const relShare = (o: Record<string, number>) => pct((o['RP MLB'] ?? 0) + (o['RP minors'] ?? 0), Object.values(o).reduce((a, b) => a + b, 0));
console.log(`relievers among players offered ${relShare(offerPos)}, among players asked for ${relShare(wantPos)} (RPs are ~30% of an MLB roster)`);

// Outcomes for the first class, SEASONS-1 years later.
const first = picks.filter((p) => p.season === S0 && p.round <= 5);
console.log(`\n=== ${S0} class after ${SEASONS - 1} seasons (rounds 1-5, ${first.length} picks) ===`);
const out = first.map((pk) => { const p = L.players[pk.pid]; return { ...pk, now: p ? ovr(p) : NaN, potNow: p ? potOvr(p) : NaN, war: p ? playerWar(L, p, {}) : 0, mlb: p ? p.mlServiceDays > 0 : false }; }).filter((x) => !Number.isNaN(x.now));
for (const [label, f] of [['HS', (x: typeof out[0]) => !x.college], ['college', (x: typeof out[0]) => x.college]] as const) {
  const g = out.filter(f);
  if (!g.length) continue;
  const m = (k: 'now' | 'war' | 'pot') => (g.reduce((t, x) => t + x[k], 0) / g.length).toFixed(1);
  console.log(`${label.padEnd(8)} n ${g.length}: draft pot ${m('pot')} → ovr now ${m('now')}; reached MLB ${pct(g.filter((x) => x.mlb).length, g.length)}; career WAR ${m('war')}; 55+ ovr now ${pct(g.filter((x) => x.now >= 55).length, g.length)}; busts (<45 now, pot ≥55 at draft) ${g.filter((x) => x.now < 45 && x.pot >= 55).length}/${g.filter((x) => x.pot >= 55).length}`);
}
// How much draft-day potential predicts where they are now.
const corr = (a: number[], b: number[]) => { const n = a.length, ma = a.reduce((x, y) => x + y) / n, mb = b.reduce((x, y) => x + y) / n; let s = 0, sa = 0, sb = 0; for (let i = 0; i < n; i++) { s += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; } return s / Math.sqrt(sa * sb); };
console.log(`corr(draft potential, ovr now) ${corr(out.map((x) => x.pot), out.map((x) => x.now)).toFixed(2)}; corr(draft potential, potential now) ${corr(out.map((x) => x.pot), out.map((x) => x.potNow)).toFixed(2)}`);
const r1 = out.filter((x) => x.round === 1).sort((a, b) => b.war - a.war);
console.log('1st round, best and worst by WAR so far:', [...r1.slice(0, 4), ...r1.slice(-4)].map((x) => `#${x.overall} ${x.pos}${x.college ? 'c' : 'hs'} pot ${x.pot.toFixed(0)}→ovr ${x.now.toFixed(0)} WAR ${x.war.toFixed(1)}`).join(' | '));
