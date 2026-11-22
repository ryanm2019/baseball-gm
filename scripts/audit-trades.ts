// Trade fairness audit: sims two seasons, scores every trade made in the first
// (and the winter after) by true talent at the time and by what each side
// actually got afterward (WAR and salary), and probes what the user can get.
//   node --experimental-strip-types scripts/audit-trades.ts
import { createLeague } from '../src/core/league.ts';
import { simOneDay } from '../src/core/sim/day.ts';
import { advanceDraft } from '../src/core/draft.ts';
import { aiAccepts, balanceForAi, emptyAssets, evaluate, validateTrade } from '../src/core/trade.ts';
import { CB_VALUE, DOLLARS_PER_WAR, projectValue, seasonFraction, warFor } from '../src/core/value.ts';
import { findPackagesFor } from '../src/core/tradeFinder.ts';
import { marketValue, serviceYears } from '../src/core/contracts.ts';
import { ovr, potOvr } from '../src/core/ratings.ts';
import { playerWar, salaryPaid } from '../src/core/war.ts';
import { orgPlayers } from '../src/core/util.ts';
import { dayLabel } from '../src/core/settings.ts';
import type { League, Level, Move, Player, TradeProposal } from '../src/core/types.ts';

const L: League = createLeague({ name: 'tradeaudit', userOrgIndex: 3, season: 2027 });
const U = L.orgs[3];
for (const k of Object.keys(U.agm)) (U.agm as Record<string, boolean>)[k] = true;
const S0 = L.season;
const M = (x: number) => (x / 1e6).toFixed(1);

// True surplus value: the game's own formula with true ratings, no scouting
// noise, no stats blend, no strategy weighting.
const RISK: Record<Level, number> = { MLB: 1, AAA: 0.85, AA: 0.72, 'A+': 0.58, A: 0.48, CPX: 0.4, DSL: 0.34 };
const YTM: Record<Level, number> = { MLB: 0, AAA: 0, AA: 1, 'A+': 2, A: 3, CPX: 4, DSL: 4 };
function trueValue(p: Player): number {
  const s = L.settings;
  const start = L.phase === 'regular' || L.phase === 'playoffs' ? L.season : L.season + 1;
  const pt = (o: number) => (o >= 47 ? 1 : o >= 43 ? 0.5 : 0.1);
  let o = ovr(p);
  const pot0 = Math.max(o, potOvr(p));
  const level = p.level ?? 'AAA';
  const toMlb = p.on40 && p.level === 'MLB' ? 0 : YTM[level] ?? 2;
  const c = p.contract;
  let svc = serviceYears(p.mlServiceDays, s);
  let total = 0, guaranteed = 0;
  for (let t = 0; t < 7; t++) {
    const season = start + t, age = season - p.born;
    if (t > 0) { if (age < 27) o += (pot0 - o) * 0.3; else if (age >= 31) o -= (age - 30) * 0.6; }
    const inMlb = t >= toMlb;
    let salary = 0;
    if (c.type === 'ML' && season <= c.exp) { salary = c.oneWay || inMlb ? c.salary : c.minorSalary; guaranteed += salary; }
    else if (c.type === 'ML' && c.option && season === c.option.season) salary = c.option.type === 'club' && o < 45 ? c.option.buyout : c.option.salary;
    else {
      const yrs = 6 - svc;
      if (c.type === 'MiLB' && !inMlb) salary = 0;
      else if (yrs <= 0) break;
      else if (svc < 3) salary = s.minSalary;
      else salary = marketValue(p, s) * [0.25, 0.4, 0.6][Math.min(2, svc - 3)];
    }
    const war = inMlb ? Math.max(-0.5, warFor(p, o)) * pt(o) : 0;
    total += (war * DOLLARS_PER_WAR - salary) * (t === 0 ? seasonFraction(L) : 1) / Math.pow(1.08, t);
    if (inMlb) svc++;
  }
  if (level !== 'MLB' && total > 0) total *= RISK[level] ?? 0.6;
  return Math.max(total, -guaranteed);
}
const consensus = (p: Player) => L.orgs.reduce((t, o) => t + projectValue(L, o, p).total, 0) / L.orgs.length;

interface Rec {
  m: Move; label: string; user: boolean; strat: string[];
  tv: number[]; cv: number[]; who: string[];
}
const recs: Rec[] = [];
// How far the league's read (consensus) is from the truth, for players who were
// traded (by level and side) vs a baseline of everyone at that level.
const misread: Record<string, number[]> = {};
const addMis = (k: string, p: Player) => (misread[k] ??= []).push(consensus(p) - trueValue(p));
const seen = new Set<number>();
function sideValue(side: Move['sides'][0], f: (p: Player) => number): number {
  let v = side.gets.reduce((t, id) => t + f(L.players[id]), 0) + side.cash + side.pool * 0.6;
  for (const d of side.picks) v += /Round A|round A|\bA\b/.test(d) ? CB_VALUE.A : CB_VALUE.B;
  return v;
}
function snap() {
  for (const m of L.moves) {
    if (m.type !== 'Trade' || seen.has(m.id)) continue;
    seen.add(m.id);
    if (m.season > S0 || m.sides.length !== 2) continue;
    const desc = (side: Move['sides'][0]) => side.gets.map((id) => { const p = L.players[id]; return `${p.last} ${p.pos} ${p.level} ${L.season - p.born}y ${ovr(p).toFixed(0)}/${potOvr(p).toFixed(0)} $${M(p.contract.salary)}${p.contract.type === 'ML' ? `→${p.contract.exp}` : ''}`; }).concat(side.cash ? [`$${M(side.cash)} cash`] : []).concat(side.pool ? [`$${M(side.pool)} pool`] : []).concat(side.picks).join(', ') || '(nothing)';
    for (const side of m.sides) for (const id of side.gets) { const p = L.players[id]; addMis(`traded ${p.level === 'MLB' ? 'MLB' : 'minors'} to a ${L.orgs[side.orgId].stance === 'Buying' ? 'buyer' : 'non-buyer'}`, p); }
    if (recs.length % 15 === 0) for (const p of Object.values(L.players).filter((q) => q.orgId !== null && !q.retired && q.on40 !== undefined).slice(0, 4000)) if (Math.random() < 0.03) addMis(`baseline ${p.level === 'MLB' ? 'MLB' : 'minors'}`, p);
    recs.push({
      m, user: m.sides.some((s) => s.orgId === U.id),
      label: `${dayLabel(m.season, m.day)} [${L.phase}]`,
      strat: m.sides.map((s) => `${L.orgs[s.orgId].abbrev}(${L.orgs[s.orgId].strategy[0]}/${L.orgs[s.orgId].stance[0]})`),
      tv: m.sides.map((s) => sideValue(s, trueValue)),
      cv: m.sides.map((s) => sideValue(s, consensus)),
      who: m.sides.map(desc),
    });
  }
}

// --- Probes of what the user can get (run on a mid-season day) ---
function probes() {
  console.log(`\n=== User probes, ${dayLabel(L.season, L.day)} ===`);
  // 1. Ask each club for its best player; what do they demand?
  const gaps: number[] = [];
  for (const ai of L.orgs) {
    if (ai.id === U.id) continue;
    const star = orgPlayers(L, ai.id).filter((p) => p.level === 'MLB' && !validateTrade(L, { orgs: [U.id, ai.id], give: [emptyAssets(), { ...emptyAssets(), pids: [p.id] }] })).sort((a, b) => trueValue(b) - trueValue(a))[0];
    if (!star) continue;
    const prop = balanceForAi(L, { orgs: [ai.id, U.id], give: [{ ...emptyAssets(), pids: [star.id] }, emptyAssets()] });
    if (!prop) continue;
    const get = trueValue(star), give = prop.give[1].pids.reduce((t, id) => t + trueValue(L.players[id]), 0) + prop.give[1].cash;
    gaps.push((get - give) / Math.max(1e6, get));
  }
  gaps.sort((a, b) => a - b);
  console.log(`Ask for each club's best player (they build the price), ${gaps.length} asks: user's net as share of the star's true value: median ${(gaps[gaps.length >> 1] * 100).toFixed(0)}%, best ${(gaps[gaps.length - 1] * 100).toFixed(0)}%, worst ${(gaps[0] * 100).toFixed(0)}%`);

  // 2. Trade Finder: best package found for 25 targets.
  const tf: number[] = [];
  const tfShow: string[] = [];
  const targets = L.orgs.filter((o) => o.id !== U.id).flatMap((o) => orgPlayers(L, o.id).filter((p) => p.level === 'MLB' && ovr(p) >= 50)).sort(() => 0.5 - Math.random()).slice(0, 25);
  for (const t of targets) {
    const ds = findPackagesFor(L, t.id, { untouchable: new Set(), allowPicks: true, kind: 'any' } as never);
    if (!ds.length) continue;
    // The user picks the package that looks best to him (his own read).
    const d = ds.sort((a, b) => (b.valueToYou - b.costToYou) - (a.valueToYou - a.costToYou))[0];
    const get = d.prop.give[1].pids.reduce((s, id) => s + trueValue(L.players[id]), 0);
    const give = d.prop.give[0].pids.reduce((s, id) => s + trueValue(L.players[id]), 0) + d.prop.give[0].cash;
    tf.push(get - give);
    if (tfShow.length < 4) tfShow.push(`  ${t.last} (${ovr(t).toFixed(0)}/${potOvr(t).toFixed(0)}, $${M(t.contract.salary)}) for ${d.prop.give[0].pids.map((id) => { const p = L.players[id]; return `${p.last} ${p.level} ${ovr(p).toFixed(0)}/${potOvr(p).toFixed(0)}`; }).join(' + ')}: true ${M(get)} vs ${M(give)}`);
  }
  tf.sort((a, b) => a - b);
  console.log(`Trade Finder top package, ${tf.length} targets: user nets median ${M(tf[tf.length >> 1] ?? 0)}M, mean ${M(tf.reduce((a, b) => a + b, 0) / (tf.length || 1))}M, share in user's favor ${(tf.filter((x) => x > 0).length / (tf.length || 1) * 100).toFixed(0)}%`);
  console.log(tfShow.join('\n'));

  // 3. Quantity for quality: 3 of the user's pieces whose true value adds up to
  // about the star's (80-120%). A real club wants the star (consolidation).
  let qAcc = 0, qTry = 0;
  const qShow: string[] = [];
  const pool = orgPlayers(L, U.id).filter((p) => p.level === 'MLB' && !validateTrade(L, { orgs: [U.id, 0], give: [{ ...emptyAssets(), pids: [p.id] }, emptyAssets()] })).map((p) => ({ p, v: trueValue(p) })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
  for (const ai of L.orgs) {
    if (ai.id === U.id) continue;
    const star = orgPlayers(L, ai.id).filter((p) => p.level === 'MLB').map((p) => ({ p, v: trueValue(p) })).sort((a, b) => b.v - a.v)[0];
    if (!star) continue;
    let trio: typeof pool | null = null;
    for (let i = 0; i < pool.length && !trio; i++) for (let j = i + 1; j < pool.length && !trio; j++) for (let k = j + 1; k < pool.length && !trio; k++) {
      const sum = pool[i].v + pool[j].v + pool[k].v;
      if (pool[i].v < star.v * 0.75 && sum >= star.v * 0.8 && sum <= star.v * 1.2) trio = [pool[i], pool[j], pool[k]];
    }
    if (!trio) continue;
    const prop: TradeProposal = { orgs: [U.id, ai.id], give: [{ ...emptyAssets(), pids: trio.map((x) => x.p.id) }, { ...emptyAssets(), pids: [star.p.id] }] };
    if (validateTrade(L, prop)) continue;
    qTry++;
    if (aiAccepts(L, ai, prop)) { qAcc++; if (qShow.length < 3) qShow.push(`  ${ai.abbrev} takes ${trio.map((x) => `${x.p.last} ${ovr(x.p).toFixed(0)}`).join(' + ')} for ${star.p.last} ${ovr(star.p).toFixed(0)}: true ${M(star.v)} vs ${M(trio.reduce((t, x) => t + x.v, 0))}`); }
  }
  console.log(`3 pieces adding up to about a club's most valuable player, for him: accepted ${qAcc}/${qTry}`);
  console.log(qShow.join('\n'));

  // 4. Salary dump: the user's worst contract for nothing.
  const bad = orgPlayers(L, U.id).filter((p) => p.contract.type === 'ML' && p.contract.exp > L.season).sort((a, b) => trueValue(a) - trueValue(b))[0];
  if (bad) {
    const acc = L.orgs.filter((ai) => ai.id !== U.id && aiAccepts(L, ai, { orgs: [U.id, ai.id], give: [{ ...emptyAssets(), pids: [bad.id] }, emptyAssets()] }));
    console.log(`Dump ${bad.last} (true ${M(trueValue(bad))}M, $${M(bad.contract.salary)} thru ${bad.contract.exp}) for nothing: ${acc.length} clubs accept`);
  }
  // 5. How far the user's own read is from the truth vs the AI's (shared noise direction).
  const sample = L.orgs.filter((o) => o.id !== U.id).flatMap((o) => orgPlayers(L, o.id).filter((p) => p.level === 'MLB')).slice(0, 300);
  const userErr = sample.map((p) => Math.abs(projectValue(L, U, p).total - trueValue(p)));
  const aiErr = sample.map((p) => Math.abs(projectValue(L, L.orgs[p.orgId!], p).total - trueValue(p)));
  console.log(`Mean abs read error ($M): user ${M(userErr.reduce((a, b) => a + b) / userErr.length)}, owning club ${M(aiErr.reduce((a, b) => a + b) / aiErr.length)}`);
}

let guard = 0, probed = false;
const t0 = Date.now();
const stops: Record<string, number> = {};
while (L.season < S0 + 2 && guard++ < 2500) {
  const r = simOneDay(L);
  if (r.stop) { const k = r.stop.replace(/[0-9$.,]+/g, '#').slice(0, 60); stops[k] = (stops[k] ?? 0) + 1; }
  if (r.stop?.includes('clock')) advanceDraft(L, true);
  snap();
  if (!probed && L.season === S0 && L.phase === 'regular' && L.day === 95) { probed = true; probes(); }
}
console.log('stops', stops);
console.log(`\nsimmed to ${dayLabel(L.season, L.day)} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

// --- Hindsight: what each side actually got (WAR value minus salary paid, from the trade season on) ---
for (const r of recs) {
  (r as Rec & { hs: number[] }).hs = r.m.sides.map((s) => s.gets.reduce((t, id) => {
    const p = L.players[id];
    if (!p) return t; // retired and pruned
    return t + playerWar(L, p, { orgId: s.orgId, from: r.m.season }) * DOLLARS_PER_WAR - salaryPaid(p, s.orgId, r.m.season);
  }, 0) + s.cash);
}
const gap = (v: number[]) => v[0] - v[1];
const rel = (v: number[]) => Math.abs(gap(v)) / Math.max(4e6, Math.abs(v[0]) + Math.abs(v[1]));
console.log(`\n=== ${recs.length} trades, ${S0} season + following winter (${recs.filter((r) => r.user).length} involve the user's club, AGM running trades) ===`);
const lop = (k: 'tv' | 'cv' | 'hs', th: number) => recs.filter((r) => Math.abs(gap((r as never)[k])) > th && rel((r as never)[k]) > 0.5);
for (const k of ['tv', 'hs'] as const) {
  const g = recs.map((r) => Math.abs(gap((r as never)[k]))).sort((a, b) => a - b);
  console.log(`${k === 'tv' ? 'True value at trade time' : 'Hindsight (WAR$ − salary)'}: |gap| median ${M(g[g.length >> 1])}M, 90th pct ${M(g[Math.floor(g.length * 0.9)])}M; lopsided (>$8M and >50% of the deal) ${lop(k, 8e6).length}`);
}
const byPhase: Record<string, number[]> = {};
for (const r of recs) { const ph = r.label.split('[')[1].slice(0, -1); (byPhase[ph] ??= []).push(Math.abs(gap(r.tv))); }
console.log('true-value |gap| by phase:', Object.fromEntries(Object.entries(byPhase).map(([k, v]) => [k, `${v.length} trades, mean ${M(v.reduce((a, b) => a + b, 0) / v.length)}M`])));
// Who wins: contenders vs rebuilders, user vs AI
const winner: Record<string, number> = {};
for (const r of recs) {
  const w = gap(r.tv) > 0 ? 0 : 1;
  if (Math.abs(gap(r.tv)) < 3e6) continue;
  const k = `${r.strat[w].split('(')[1][0]} beats ${r.strat[1 - w].split('(')[1][0]}`;
  winner[k] = (winner[k] ?? 0) + 1;
}
console.log('who wins by true value (C contend, R retool, B rebuild; gap ≥$3M):', winner);
const userRecs = recs.filter((r) => r.user);
if (userRecs.length) console.log('user club net true value per trade:', userRecs.map((r) => M(r.m.sides[0].orgId === U.id ? gap(r.tv) : -gap(r.tv))).join(', '));

console.log('league read minus truth ($M), mean (n):', Object.fromEntries(Object.entries(misread).map(([k, v]) => [k, `${M(v.reduce((a, b) => a + b, 0) / v.length)} (${v.length})`])));
console.log('\nMost lopsided by true value at the time (side A gets | side B gets | true $M A,B | hindsight $M A,B):');
for (const r of [...recs].sort((a, b) => Math.abs(gap(b.tv)) - Math.abs(gap(a.tv))).slice(0, 12)) {
  const h = (r as Rec & { hs: number[] }).hs;
  console.log(`${r.label} ${r.strat[0]} gets ${r.who[0]}\n    ${r.strat[1]} gets ${r.who[1]}\n    true ${M(r.tv[0])}, ${M(r.tv[1])} | consensus ${M(r.cv[0])}, ${M(r.cv[1])} | hindsight ${M(h[0])}, ${M(h[1])}`);
}
