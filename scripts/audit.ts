// Multi-season audit: sims N seasons hands-off and reports everything that
// could look wrong to a baseball person. Usage: node --experimental-strip-types scripts/audit.ts 5
import { createLeague } from '../src/core/league.ts';
import { simOneDay } from '../src/core/sim/day.ts';
import { advanceDraft } from '../src/core/draft.ts';
import { activeAt, fortyMan, orgPlayers, sumBat, sumPit } from '../src/core/util.ts';
import { isPitcher, ovr, potOvr, displayOvr } from '../src/core/ratings.ts';
import { orgPayroll } from '../src/core/contracts.ts';
import { playerWar } from '../src/core/war.ts';
import { dayLabel, dayToDate } from '../src/core/settings.ts';
import { deptSpend } from '../src/core/depts.ts';
import type { League, Player } from '../src/core/types.ts';

const N = Number(process.argv[2] ?? 5);
const L: League = createLeague({ name: 'audit', userOrgIndex: 3, season: 2027 });
const u = L.orgs[3];
for (const k of Object.keys(u.agm)) (u.agm as Record<string, boolean>)[k] = true;
for (const s of L.staff) if (s.orgId === 3) s.exp = 2100;
L.settings.allowFiring = false;

const fmt = (x: number, d = 3) => (x >= 1 || d === 0 ? x.toFixed(d) : x.toFixed(d).replace(/^0/, ''));
const age = (p: Player) => L.season - p.born;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(q * (s.length - 1))] ?? 0; };
const stopCounts: Record<string, number> = {};
let stuckShown = false;
const errors: string[] = [];
const t0 = Date.now();

function seasonReport(season: number) {
  const players = Object.values(L.players);
  const mlbE = players.flatMap((p) => p.stats.filter((s) => s.season === season && s.level === 'MLB').map((s) => ({ p, s })));
  const b = sumBat(mlbE.map((x) => x.s));
  const pt = sumPit(mlbE.map((x) => x.s));
  const games = L.schedule.filter((g) => g.level === 'MLB' && g.result && !g.playoff).length || mlbE.reduce((t, x) => t + x.s.pit.gs, 0) / 2;
  const obp = (b.h + b.bb + b.hbp) / (b.ab + b.bb + b.hbp + b.sf);
  const slg = (b.h + b.d + 2 * b.t + 3 * b.hr) / b.ab;
  console.log(`\n=== ${season} MLB environment ===`);
  console.log(`R/G ${(pt.r / Math.max(1, games) / 2).toFixed(2)} | ${fmt(b.h / b.ab)}/${fmt(obp)}/${fmt(slg)} | K% ${(100 * b.k / b.pa).toFixed(1)} BB% ${(100 * b.bb / b.pa).toFixed(1)} HR ${b.hr} SB ${b.sb} CS ${b.cs} | ERA ${(pt.er * 27 / pt.outs).toFixed(2)} | SV ${pt.sv} HLD ${pt.hld} BS ${pt.bs} | CG ${'n/a'}`);
  // Leaders
  type Agg = { p: Player; pa: number; ab: number; h: number; hr: number; rbi: number; sb: number; bb: number; k: number; d: number; t: number; hbp: number; sf: number; outs: number; er: number; pk: number; w: number; sv: number; g: number; gs: number; hld: number };
  const agg = new Map<number, Agg>();
  for (const { p, s } of mlbE) {
    const a = agg.get(p.id) ?? { p, pa: 0, ab: 0, h: 0, hr: 0, rbi: 0, sb: 0, bb: 0, k: 0, d: 0, t: 0, hbp: 0, sf: 0, outs: 0, er: 0, pk: 0, w: 0, sv: 0, g: 0, gs: 0, hld: 0 };
    a.pa += s.bat.pa; a.ab += s.bat.ab; a.h += s.bat.h; a.hr += s.bat.hr; a.rbi += s.bat.rbi; a.sb += s.bat.sb; a.bb += s.bat.bb; a.k += s.bat.k; a.d += s.bat.d; a.t += s.bat.t; a.hbp += s.bat.hbp; a.sf += s.bat.sf;
    a.outs += s.pit.outs; a.er += s.pit.er; a.pk += s.pit.k; a.w += s.pit.w; a.sv += s.pit.sv; a.g += s.pit.g; a.gs += s.pit.gs; a.hld += s.pit.hld;
    agg.set(p.id, a);
  }
  const A = [...agg.values()];
  const q = A.filter((a) => a.pa >= 502);
  const top = <T,>(xs: T[], f: (x: T) => number, n = 3) => [...xs].sort((a, b) => f(b) - f(a)).slice(0, n);
  const nm = (p: Player) => `${p.last}(${age(p)})`;
  console.log(`Qualified hitters ${q.length} | AVG ${top(q, (a) => a.h / a.ab).map((a) => `${nm(a.p)} ${fmt(a.h / a.ab)}`).join(', ')} | HR ${top(A, (a) => a.hr).map((a) => `${nm(a.p)} ${a.hr}`).join(', ')} | SB ${top(A, (a) => a.sb).map((a) => `${nm(a.p)} ${a.sb}`).join(', ')} | RBI ${top(A, (a) => a.rbi).map((a) => `${nm(a.p)} ${a.rbi}`).join(', ')}`);
  const opsOf = (a: Agg) => (a.h + a.bb + a.hbp) / Math.max(1, a.ab + a.bb + a.hbp + a.sf) + (a.h + a.d + 2 * a.t + 3 * a.hr) / Math.max(1, a.ab);
  console.log(`OPS top ${top(q, opsOf).map((a) => `${nm(a.p)} ${fmt(opsOf(a))}`).join(', ')} | qualified OPS p10/p50/p90 ${fmt(pct(q.map(opsOf), 0.1))}/${fmt(pct(q.map(opsOf), 0.5))}/${fmt(pct(q.map(opsOf), 0.9))}`);
  const qp = A.filter((a) => a.outs >= 162 * 3);
  console.log(`Qualified SP ${qp.length} | ERA ${top(qp, (a) => -a.er / a.outs).map((a) => `${nm(a.p)} ${(a.er * 27 / a.outs).toFixed(2)}`).join(', ')} | K ${top(A, (a) => a.pk).map((a) => `${nm(a.p)} ${a.pk}`).join(', ')} | W ${top(A, (a) => a.w).map((a) => `${nm(a.p)} ${a.w}`).join(', ')} | IP max ${(Math.max(...A.map((a) => a.outs)) / 3).toFixed(0)}`);
  console.log(`SV ${top(A, (a) => a.sv).map((a) => `${nm(a.p)} ${a.sv}`).join(', ')} | HLD ${top(A, (a) => a.hld).map((a) => `${nm(a.p)} ${a.hld}`).join(', ')} | relief G max ${Math.max(...A.filter((a) => a.gs < 3).map((a) => a.g))}, relievers 75+ G: ${A.filter((a) => a.gs < 3 && a.g >= 75).length}`);
  const wars = players.map((p) => ({ p, w: playerWar(L, p, { season }) })).filter((x) => x.w);
  console.log(`WAR total hitters ${wars.filter((x) => !isPitcher(x.p)).reduce((t, x) => t + x.w, 0).toFixed(0)} pitchers ${wars.filter((x) => isPitcher(x.p)).reduce((t, x) => t + x.w, 0).toFixed(0)} | top ${top(wars, (x) => x.w, 5).map((x) => `${x.p.pos} ${nm(x.p)} ${x.w.toFixed(1)}`).join(', ')} | 6+ WAR: ${wars.filter((x) => x.w >= 6).length}`);
  // Standings
  const st = L.standings.MLB;
  const wins = L.orgs.map((o) => st[o.id].w);
  const d = L.draft;
  if (d) {
    const grp = (lo: number, hi: number) => { const ps = d.picks.filter((x) => x.round >= lo && x.round <= hi && x.pid !== null); return `${ps.filter((x) => x.signed).length}/${ps.length}`; };
    const taxes = (L.draftTax ?? []).filter((t) => t.season === season);
    const fly = d.picks.filter((x) => x.round >= 11 && x.signed && x.pid !== null && (L.players[x.pid]?.contract.bonus ?? 0) >= 500_000);
    console.log(`Late-round flyers signed (R11+, $500k+): ${fly.length} | ${fly.slice(0, 4).map((x) => `R${x.round} ${L.orgs[x.orgId].abbrev} $${((L.players[x.pid!].contract.bonus ?? 0) / 1e6).toFixed(2)}M`).join(', ')}`);
    console.log(`Draft signed R1 ${grp(1, 1)} R2-10 ${grp(2, 10)} R11+ ${grp(11, 99)} | over pool: ${taxes.length} teams, >5%: ${taxes.filter((t) => t.penalty.includes('pick')).length}`);
  }
  {
    const top = L.orgs.map((o) => ({ o, w: st[o.id].w, pay: orgPayroll(L, o).cbt })).sort((a, b) => b.w - a.w).slice(0, 3);
    console.log(`Top teams: ${top.map((x) => `${x.o.abbrev} ${x.w}W pay ${(x.pay / 1e6).toFixed(0)}M budget ${(x.o.budget / 1e6).toFixed(0)}M owner ${x.o.owner.type} 60+ players ${Object.values(L.players).filter((p) => p.orgId === x.o.id && p.level === 'MLB' && ovr(p) >= 60).length}`).join(' | ')}`);
    const over = L.orgs.map((o) => ({ o, pay: orgPayroll(L, o).cbt })).filter((x) => x.pay > x.o.budget * 1.05);
    for (const x of over.slice(0, 4)) {
      const mine = Object.values(L.players).filter((p) => p.orgId === x.o.id && p.contract.type === 'ML');
      const ext = mine.filter((p) => (L.moves ?? []).some((m) => m.type === 'Extension' && m.season === season && m.sides[0].orgId === x.o.id && m.sides[0].gets.includes(p.id)));
      const fa = mine.filter((p) => p.faSigned === season || p.faSigned === season + 1);
      const tr = mine.filter((p) => p.joined && p.joined.season === season && !fa.includes(p) && p.teamSince === season);
      const dead = (x.o.deadMoney ?? []).filter((d) => d.season === season).reduce((t, d) => t + d.amount, 0);
      console.log(`   ${x.o.abbrev} start-budget? ${(x.o.budget / 1e6).toFixed(0)} | ext ${ext.length} aav ${(ext.reduce((t, p) => t + (p.contract.aav ?? p.contract.salary), 0) / 1e6).toFixed(0)}M | FA ${fa.length} ${(fa.reduce((t, p) => t + (p.contract.aav ?? p.contract.salary), 0) / 1e6).toFixed(0)}M | acquired ${tr.length} ${(tr.reduce((t, p) => t + (p.contract.aav ?? p.contract.salary), 0) / 1e6).toFixed(0)}M | dead ${(dead / 1e6).toFixed(0)}M`);
    }
    console.log(`Over budget >5%: ${over.map((x) => `${x.o.abbrev} ${(x.pay / 1e6).toFixed(0)}/${(x.o.budget / 1e6).toFixed(0)}M`).join(', ')}`);
  }
  console.log(`Standings: best ${Math.max(...wins)} worst ${Math.min(...wins)} | 95+ wins: ${wins.filter((w) => w >= 95).length}, <=65: ${wins.filter((w) => w <= 65).length} | champion ${L.playoffs?.champion !== undefined && L.playoffs?.champion !== null ? L.orgs[L.playoffs.champion].abbrev : '?'}`);
}

function stateReport(tag: string) {
  const players = Object.values(L.players).filter((p) => !p.retired);
  const org = players.filter((p) => p.orgId !== null);
  const mlb = org.filter((p) => p.level === 'MLB');
  console.log(`\n--- ${tag} (${dayLabel(L.season, L.day)}, ${L.phase}) ---`);
  console.log(`MLB: n ${mlb.length} avg ovr ${avg(mlb.map(ovr)).toFixed(1)} age ${avg(mlb.map(age)).toFixed(1)} | 70+ ${mlb.filter((p) => displayOvr(p, ovr(p)) >= 70).length} 65+ ${mlb.filter((p) => displayOvr(p, ovr(p)) >= 65).length} 60+ ${mlb.filter((p) => displayOvr(p, ovr(p)) >= 60).length} | 37+: ${mlb.filter((p) => age(p) >= 37).length}, <=22: ${mlb.filter((p) => age(p) <= 22).length}`);
  for (const lv of ['AAA', 'AA', 'A+', 'A', 'CPX', 'DSL'] as const) {
    const ps = org.filter((p) => p.level === lv);
    process.stdout.write(`${lv} n${ps.length} ovr ${avg(ps.map(ovr)).toFixed(1)} age ${avg(ps.map(age)).toFixed(1)} | `);
  }
  console.log('');
  // Rosters
  let bad = 0; const badList: string[] = [];
  for (const o of L.orgs) {
    const a = activeAt(L, o.id, 'MLB').length; const f = fortyMan(L, o.id).length;
    if ((L.phase === 'regular' && (a < 26 || a > 28)) || f > 40) { bad++; badList.push(`${o.abbrev} active ${a} 40m ${f}`); }
  }
  const fortyCounts = L.orgs.map((o) => fortyMan(L, o.id).length);
  console.log(`Roster problems: ${bad} ${badList.slice(0, 4).join('; ')} | 40-man min/avg/max ${Math.min(...fortyCounts)}/${avg(fortyCounts).toFixed(1)}/${Math.max(...fortyCounts)}`);
  const orgSizes = L.orgs.map((o) => orgPlayers(L, o.id).length);
  console.log(`Org sizes min/avg/max ${Math.min(...orgSizes)}/${avg(orgSizes).toFixed(0)}/${Math.max(...orgSizes)}`);
  // Free agents
  const fa = players.filter((p) => p.orgId === null && !p.prospect && !p.ifa);
  const goodFa = fa.filter((p) => displayOvr(p, ovr(p)) >= 50);
  console.log(`Free agents ${fa.length}, of them 50+ ovr: ${goodFa.length} ${goodFa.slice(0, 6).map((p) => `${p.pos} ${displayOvr(p, ovr(p)).toFixed(0)} age ${age(p)} ask ${p.fa ? (p.fa.asking.aav / 1e6).toFixed(1) + 'M' : '-'}`).join(', ')}`);
  // Money
  const pays = L.orgs.map((o) => orgPayroll(L, o).cbt);
  const over = L.orgs.filter((o, i) => pays[i] > L.settings.cbtThreshold).length;
  const overBudget = L.orgs.filter((o, i) => pays[i] > o.budget * 1.05).length;
  console.log(`CBT payroll min/med/max ${(Math.min(...pays) / 1e6).toFixed(0)}/${(pct(pays, 0.5) / 1e6).toFixed(0)}/${(Math.max(...pays) / 1e6).toFixed(0)}M | over CBT ${over} | >5% over owner budget ${overBudget} | dept spend avg ${(avg(L.orgs.map(deptSpend)) / 1e6).toFixed(0)}M`);
  const sal = mlb.filter((p) => p.contract.type === 'ML').map((p) => p.contract.salary);
  console.log(`MLB salary median ${(pct(sal, 0.5) / 1e6).toFixed(2)}M p90 ${(pct(sal, 0.9) / 1e6).toFixed(1)}M max ${(Math.max(...sal) / 1e6).toFixed(1)}M | min-salary players ${sal.filter((s) => s <= L.settings.minSalary + 1).length}`);
  const strat: Record<string, number> = {}; for (const o of L.orgs) strat[o.strategy] = (strat[o.strategy] ?? 0) + 1;
  const stance: Record<string, number> = {}; for (const o of L.orgs) stance[o.stance] = (stance[o.stance] ?? 0) + 1;
  console.log(`Strategies ${JSON.stringify(strat)} stances ${JSON.stringify(stance)} | staff vacancies ${L.orgs.reduce((t, o) => t + (9 - Object.keys(o.staff).length), 0)}`);
}

stateReport('Start');
let guard = 0;
const startSeason = L.season;
let lastSeason = L.season;
const reported = new Set<number>();
const opened = new Set<number>([L.season]);
while (L.season < startSeason + N && guard++ < N * 600) {
  let r;
  try {
    r = simOneDay(L);
  } catch (e) {
    errors.push(`${dayLabel(L.season, L.day)} ${(e as Error).stack?.split('\n').slice(0, 3).join(' | ')}`);
    L.day++;
    continue;
  }
  if (r.stop && r.stop.includes('active roster')) {
    const o = L.orgs[3];
    if (!stuckShown) { stuckShown = true; console.log('STUCK DEBUG', dayLabel(L.season, L.day), r.stop, '40-man', fortyMan(L, 3).length, 'active', activeAt(L, 3, 'MLB').length, 'agm', JSON.stringify(o.agm)); }
  }
  if (r.stop) {
    const key = r.stop.replace(/[0-9$.,]+/g, '#').slice(0, 70);
    stopCounts[key] = (stopCounts[key] ?? 0) + 1;
    if (r.stop.includes('clock')) advanceDraft(L, true);
  }
  if (L.phase === 'offseason' && !reported.has(L.season)) {
    reported.add(L.season);
    seasonReport(L.season);
  }
  if (L.phase === 'regular' && L.day === 0 && !opened.has(L.season)) {
    opened.add(L.season);
    stateReport(`Opening Day ${L.season}`);
  }
  if (L.season !== lastSeason) {
    lastSeason = L.season;
    stateReport(`Spring ${L.season}`);
  }
}
console.log(`\n=== Run summary ===`);
console.log(`time ${((Date.now() - t0) / 1000).toFixed(0)}s, iterations ${guard}, ended ${dayLabel(L.season, L.day)} ${L.phase}`);
console.log('stops:', stopCounts);
console.log('errors:', errors.slice(0, 5));
// Transactions
const tx: Record<string, number> = {}; for (const t of L.transactions) tx[t.type] = (tx[t.type] ?? 0) + 1;
console.log('transactions (last ~2 seasons):', tx);
const mv: Record<string, Record<number, number>> = {};
for (const m of L.moves) { (mv[m.type] ??= {})[m.season] = (mv[m.type][m.season] ?? 0) + 1; }
console.log('moves by type & season:', JSON.stringify(mv));
const byMonth: Record<string, number> = {};
for (const m of L.moves.filter((m) => m.type === 'Trade')) { const d = dayToDate(m.season, m.day); const k = `${d.getUTCMonth() + 1}`; byMonth[k] = (byMonth[k] ?? 0) + 1; }
console.log('trades by calendar month (all seasons):', byMonth);
const faMoves = L.moves.filter((m) => m.type === 'Free agent').sort((a, b) => b.cost - a.cost).slice(0, 8);
console.log('biggest FA deals:', faMoves.map((m) => `${m.text} total ${(m.cost / 1e6).toFixed(0)}M`).join(' || '));
// Draft outcomes: first rounders of the first draft
const r1 = L.moves.filter((m) => m.type === 'Draft' && m.season === startSeason && /round 1[,)]/.test(m.text));
console.log(`First draft's first round signed: ${r1.length} | now:`, r1.slice(0, 10).map((m) => { const p = L.players[m.sides[0].gets[0]]; return p ? `${p.level ?? 'FA'} ${ovr(p).toFixed(0)}/${potOvr(p).toFixed(0)} age ${age(p)}` : '?'; }).join(', '));
const allDraft = L.moves.filter((m) => m.type === 'Draft');
const reached = allDraft.filter((m) => { const p = L.players[m.sides[0].gets[0]]; return p && p.stats.some((s) => s.level === 'MLB'); }).length;
console.log(`Draftees signed ${allDraft.length}, reached MLB already: ${reached}`);
// User
console.log(`User job security ${u.owner.patience}, goals ${JSON.stringify(u.goals?.items.map((g) => [g.text, g.met]))}`);
// Retirements & ages
const retired = Object.values(L.players).filter((p) => p.retired);
console.log(`Retired ${retired.length}; retire age avg ${avg(retired.map((p) => (p.retired ?? L.season) - p.born)).toFixed(1)}`);
console.log(`Save size ~${(JSON.stringify(L).length / 1e6).toFixed(1)} MB, players ${Object.keys(L.players).length}, moves ${L.moves.length}, news ${L.news.length}, transactions ${L.transactions.length}`);

// Contracts: extensions, clauses, opt-outs, vesting, vetoes, deferrals.
{
  const tx = L.transactions;
  const cnt = (re: RegExp) => tx.filter((t) => re.test(t.text)).length;
  const ext = (L.moves ?? []).filter((m) => m.type === 'Extension');
  console.log(`Extensions ${ext.length} (biggest: ${[...ext].sort((a, b) => b.cost - a.cost).slice(0, 3).map((m) => m.text).join(' || ')})`);
  console.log(`Opt-outs exercised ${cnt(/opted out/)} | vesting vested ${cnt(/Vesting option vested/)} | mutual exercised ${cnt(/Both sides exercised/)} declined ${cnt(/Mutual option declined/)} | club options exercised ${cnt(/Exercised the club option/)} declined ${cnt(/Declined the club option/)}`);
  const ml = Object.values(L.players).filter((p) => p.orgId !== null && p.contract.type === 'ML');
  console.log(`Active deals with: sched ${ml.filter((p) => p.contract.sched).length}, opt-outs ${ml.filter((p) => p.contract.optOuts?.length).length}, NTC ${ml.filter((p) => p.contract.ntc).length}, deferred ${ml.filter((p) => p.contract.deferPct).length}, options ${ml.filter((p) => p.contract.option).length} | veto news ${L.news.filter((n) => /no-trade clause to veto/.test(n.text)).length}`);
}

// Morale, agents, Inbox.
{
  const mlb = Object.values(L.players).filter((p) => p.orgId !== null && p.level === 'MLB' && p.morale);
  const v = mlb.map((p) => p.morale!.value).sort((a, b) => a - b);
  const q = (f: number) => v[Math.floor(f * (v.length - 1))]?.toFixed(0);
  console.log(`MLB morale n ${v.length} p10/p50/p90 ${q(0.1)}/${q(0.5)}/${q(0.9)} | miserable(<30) ${v.filter((x) => x < 30).length} thrilled(>=80) ${v.filter((x) => x >= 80).length}`);
  const kinds: Record<string, number> = {};
  for (const m of L.inbox ?? []) kinds[m.kind + (m.from.startsWith('Agent') ? '(agent)' : '')] = (kinds[m.kind + (m.from.startsWith('Agent') ? '(agent)' : '')] ?? 0) + 1;
  console.log('Inbox kinds (last 200):', JSON.stringify(kinds), '| agents', L.agents?.length, '| super-agent clients', Object.values(L.players).filter((p) => p.agent === 0).length);
  const byOrg = L.orgs.map((o) => { const ps = mlb.filter((p) => p.orgId === o.id); return { o, m: ps.reduce((t, p) => t + p.morale!.value, 0) / Math.max(1, ps.length), w: L.standings.MLB[o.id].w }; }).sort((a, b) => b.m - a.m);
  console.log('Happiest clubs:', byOrg.slice(0, 3).map((x) => `${x.o.abbrev} ${x.m.toFixed(0)} (${x.w}W)`).join(', '), '| unhappiest:', byOrg.slice(-3).map((x) => `${x.o.abbrev} ${x.m.toFixed(0)} (${x.w}W)`).join(', '));
}

// Storylines.
{
  const st = L.stories ?? [];
  const k: Record<string, number> = {};
  for (const s of st) { const key = s.title.replace(/^.*(adds a pitch|rebuilds his swing|turns heads|is locked in|scuffling|has lost the zone|playing for a contract|chases|under his wing|honored|retires|suspended 80 games)$/, '$1'); k[key] = (k[key] ?? 0) + 1; }
  console.log(`Storylines (last 300): ${st.length} |`, JSON.stringify(k));
  const fx = Object.values(L.players).filter((p) => p.storyFx?.length).length;
  console.log(`Players with active story effects: ${fx}`);
}

// Awards, Hall of Fame, finances, rehab, projections.
{
  const aw = L.awards ?? [];
  const seasonsWith = [...new Set(aw.filter((a) => a.award === 'MVP').map((a) => a.season))];
  console.log(`Awards: seasons ${seasonsWith.join(',')} | All-Stars ${aw.filter((a) => a.award === 'All-Star').length} | last MVPs: ${aw.filter((a) => a.award === 'MVP').slice(-2).map((a) => `${a.lg} ${L.players[a.pid]?.last} (${a.line})`).join(' / ')}`);
  console.log(`Hall of Fame: ${(L.hof ?? []).length} inducted (${(L.hof ?? []).map((h) => `${L.players[h.pid]?.last} ${h.pct.toFixed(0)}%`).join(', ')}) | on ballot ${Object.values(L.hofBallot ?? {}).filter((y) => y > 0).length}`);
  const fins = L.orgs.map((o) => o.fin).filter(Boolean);
  const revs = fins.map((f) => f!.last?.revenue ?? 0).sort((a, b) => a - b);
  console.log(`Revenue last season min/med/max ${(revs[0] / 1e6).toFixed(0)}/${(revs[15] / 1e6).toFixed(0)}/${(revs[29] / 1e6).toFixed(0)}M | avg attendance ${Math.round(fins.reduce((t, f) => t + (f!.last?.avgAtt ?? 0), 0) / fins.length)} | hype range ${Math.round(Math.min(...fins.map((f) => f!.hype)))}-${Math.round(Math.max(...fins.map((f) => f!.hype)))} | budgets ${(Math.min(...L.orgs.map((o) => o.budget)) / 1e6).toFixed(0)}-${(Math.max(...L.orgs.map((o) => o.budget)) / 1e6).toFixed(0)}M`);
  console.log(`Rehab assignments active now: ${Object.values(L.players).filter((p) => p.rehab).length} | season records ${(L.seasonRecs ?? []).length} | offenseAdj ${(L.offenseAdj ?? 0).toFixed(2)} devAdj ${(L.devAdj ?? 1).toFixed(2)}`);
}

// Position changes and catchers.
{
  const pos = L.transactions.filter((t) => t.type === 'Position');
  const kinds: Record<string, number> = {};
  for (const t of pos) { const m = t.text.match(/from (\w+) to (\w+)/); if (m) kinds[`${m[1]}>${m[2]}`] = (kinds[`${m[1]}>${m[2]}`] ?? 0) + 1; }
  console.log(`Position moves (transaction log): ${pos.length}`, JSON.stringify(kinds));
  const cs = Object.values(L.players).filter((p) => p.pos === 'C' && p.level === 'MLB');
  const last = L.phase === 'regular' || L.phase === 'playoffs' ? L.season : L.season - 1;
  const pa = Object.values(L.players).filter((p) => p.pos === 'C').map((p) => p.stats.filter((e) => e.season === last && e.level === 'MLB').reduce((t, e) => t + e.bat.pa, 0)).sort((a, b) => b - a);
  console.log(`Catchers: top PA ${pa.slice(0, 5).join(', ')} | teams with <2 C ${L.orgs.filter((o) => cs.filter((p) => p.orgId === o.id).length < 2).length}`);
}

// Injury decisions, playoff rosters, splits, September.
{
  const po = Object.keys(L.playoffs?.rosters ?? {}).length;
  const withSplits = Object.values(L.players).filter((p) => p.stats.some((e) => e.splits)).length;
  console.log(`Serious-injury decisions pending/active: ${Object.values(L.players).filter((p) => p.injury?.decision).length} | rehab re-injury watch ${Object.values(L.players).filter((p) => p.reinjury).length} | re-injuries in news ${L.news.filter((n) => /re-injured/.test(n.text)).length} | playoff rosters (last postseason) ${po} | players with splits ${withSplits} | September notes ${(L.inbox ?? []).filter((m) => m.kind === 'september').length}`);
}
