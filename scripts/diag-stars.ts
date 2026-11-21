// Diagnose top-end WAR: component breakdown and ratings of the best hitters.
import { createLeague } from '../src/core/league.ts';
import { simOneDay } from '../src/core/sim/day.ts';
import { seasonCtx, wobaNum, wobaDen } from '../src/core/war.ts';
import { isPitcher, ovr, defAt, displayOvr } from '../src/core/ratings.ts';
import { ops } from '../src/core/util.ts';
const L = createLeague({ name: 't', userOrgIndex: 28, season: 2027 });
for (const k of Object.keys(L.orgs[28].agm)) (L.orgs[28].agm as any)[k] = true;
const seasons = Number(process.argv[2] ?? 1);
for (let s = 0; s < seasons; s++) {
  const yr = L.season;
  let g = 0;
  while (L.phase !== 'regular' && g++ < 400) { simOneDay(L); if ((L as any).stop) (L as any).stop = null; }
  g = 0;
  while (L.phase === 'regular' && g++ < 400) { simOneDay(L); }
  const ctx = seasonCtx(L, yr);
  const rows: any[] = [];
  for (const p of Object.values(L.players)) {
    if (isPitcher(p)) continue;
    const e = p.stats.find((x) => x.season === yr && x.level === 'MLB');
    if (!e || e.bat.pa < 400) continue;
    const b = e.bat;
    const woba = wobaNum(b) / wobaDen(b);
    const batting = ((woba - ctx.woba) / ctx.wobaScale) * b.pa;
    const running = 0.2 * b.sb - 0.41 * b.cs - 0.3 * Math.max(0, b.gidp - b.pa * 0.018);
    const share = b.pa / 650;
    const fielding = p.pos === 'DH' ? 0 : (defAt(p, p.pos as any) - 50) * 0.3 * share;
    rows.push({ p, b, woba, batting, running, fielding, war: (batting + running + fielding) / ctx.rpw });
  }
  rows.sort((a, b) => b.war - a.war);
  console.log(`== ${yr} ctx woba ${ctx.woba.toFixed(3)} scale ${ctx.wobaScale.toFixed(2)} rpw ${ctx.rpw.toFixed(2)} offenseAdj ${(L.offenseAdj ?? 0).toFixed(2)}`);
  for (const r of rows.slice(0, 10)) {
    const p = r.p, v = p.ratings.vR, l = p.ratings.vL;
    console.log(`${p.pos.padEnd(2)} ${p.last.padEnd(11)} age ${yr - p.born} ovr ${displayOvr(p, ovr(p)).toFixed(0)} | PA ${r.b.pa} OPS ${ops(r.b).toFixed(3)} wOBA ${r.woba.toFixed(3)} HR ${r.b.hr} SB ${r.b.sb}/${r.b.cs} | runs bat ${r.batting.toFixed(0)} run ${r.running.toFixed(0)} fld ${r.fielding.toFixed(0)} | vR babip ${v.babip} K ${v.avoidK} gap ${v.gap} pow ${v.power} eye ${v.eye} | vL ${l.babip}/${l.avoidK}/${l.gap}/${l.power}/${l.eye} | spd ${p.ratings.run.speed} stl ${p.ratings.run.steal} def ${defAt(p, p.pos as any).toFixed(0)}`);
  }
  const top = rows.slice(0, 30);
  const avg = (f: (r: any) => number) => (top.reduce((a, r) => a + f(r), 0) / top.length).toFixed(1);
  console.log(`top30 avg runs: bat ${avg((r) => r.batting)} run ${avg((r) => r.running)} fld ${avg((r) => r.fielding)}`);
  // rating distribution among MLB regulars
  const reg = rows;
  for (const k of ['babip', 'avoidK', 'gap', 'power', 'eye'] as const) {
    const xs = reg.map((r) => r.p.ratings.vR[k]).sort((a: number, b: number) => b - a);
    console.log(`  ${k} top5 ${xs.slice(0, 5).join(',')} p90 ${xs[Math.floor(xs.length * 0.1)]} p50 ${xs[Math.floor(xs.length / 2)]}`);
  }
  const sp = reg.map((r) => r.p.ratings.run.speed).sort((a: number, b: number) => b - a);
  console.log(`  speed top5 ${sp.slice(0, 5).join(',')} | SB leaders ${rows.map(r=>r.b.sb).sort((a:number,b:number)=>b-a).slice(0,5).join(',')}`);
  if (s < seasons - 1) { g = 0; while (L.phase !== 'regular' && g++ < 400) simOneDay(L); }
}
