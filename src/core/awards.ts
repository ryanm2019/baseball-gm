// Awards, All-Stars, the Hall of Fame and the season archive.
//
//  All-Star break: All-Stars for each league (every club represented).
//  Season end: MVP, Cy Young, Rookie of the Year, Reliever of the Year, Gold
//  Gloves and Silver Sluggers in each league; the season's records go in the
//  archive.
//  Each winter: Hall of Fame voting for players retired five or more seasons
//  (ten years on the ballot), scored on career WAR, awards and milestones.
import type { AwardName, AwardRec, BatStats, League, PitStats, Player } from './types.ts';
import { defAt, isPitcher } from './ratings.ts';
import { batAdvanced, batWar, pitAdvanced, pitWar, seasonCtx } from './war.ts';
import { addNews, emptyBat, emptyPit, pname } from './util.ts';
import { posLabel } from './rules.ts';
import { moraleEvent } from './morale.ts';
import { normal } from './random.ts';
import { addScoop } from './util.ts';
import type { FieldPos } from './types.ts';

interface Line { p: Player; orgId: number; lg: 'AL' | 'NL'; b: BatStats; s: PitStats; war: number }

const fmt3 = (x: number) => x.toFixed(3).replace(/^0/, '');

function seasonLines(league: League, season: number): Line[] {
  const ctx = seasonCtx(league, season);
  const out: Line[] = [];
  for (const p of Object.values(league.players)) {
    const es = p.stats.filter((e) => e.season === season && e.level === 'MLB');
    if (!es.length) continue;
    const b = emptyBat();
    const s = emptyPit();
    for (const e of es) {
      for (const k of Object.keys(b) as (keyof BatStats)[]) b[k] += e.bat[k];
      for (const k of Object.keys(s) as (keyof PitStats)[]) s[k] += e.pit[k];
    }
    const last = es[es.length - 1];
    const org = league.orgs[last.orgId];
    if (!org) continue;
    const war = (isPitcher(p) ? 0 : batWar(p, b, ctx)) + pitWar(s, ctx);
    out.push({ p, orgId: last.orgId, lg: org.league, b, s, war });
  }
  return out;
}

const batLine = (l: Line) => {
  const b = l.b;
  const obp = (b.h + b.bb + b.hbp) / Math.max(1, b.ab + b.bb + b.hbp + b.sf);
  const slg = (b.h + b.d + 2 * b.t + 3 * b.hr) / Math.max(1, b.ab);
  return `${fmt3(b.h / Math.max(1, b.ab))}/${fmt3(obp)}/${fmt3(slg)}, ${b.hr} HR, ${b.rbi} RBI, ${l.war.toFixed(1)} WAR`;
};
const pitLine = (l: Line) => `${l.s.w}-${l.s.l}, ${((l.s.er * 27) / Math.max(1, l.s.outs)).toFixed(2)} ERA, ${l.s.k} K, ${l.s.sv ? `${l.s.sv} SV, ` : ''}${l.war.toFixed(1)} WAR`;
const lineOf = (l: Line) => (isPitcher(l.p) ? pitLine(l) : batLine(l));

function give(league: League, l: Line, award: AwardName, pos?: string): AwardRec {
  const rec: AwardRec = { season: league.season, award, lg: l.lg, pid: l.p.id, orgId: l.orgId, pos, line: lineOf(l) };
  league.awards ??= [];
  league.awards.push(rec);
  moraleEvent(league, l.p, award === 'MVP' || award === 'Cy Young' ? 10 : award === 'All-Star' ? 5 : 4, award === 'All-Star' ? 'Named an All-Star' : `Won the ${award}`);
  return rec;
}

// ---------- All-Stars ----------

const OF: FieldPos[] = ['LF', 'CF', 'RF'];

export function selectAllStars(league: League): void {
  if ((league.awards ?? []).some((a) => a.season === league.season && a.award === 'All-Star')) return;
  const lines = seasonLines(league, league.season);
  for (const lg of ['AL', 'NL'] as const) {
    const mine = lines.filter((l) => l.lg === lg && league.players[l.p.id].orgId === l.orgId);
    const picked = new Set<number>();
    const take = (ls: Line[], n: number) => { for (const l of ls.filter((x) => !picked.has(x.p.id)).slice(0, n)) picked.add(l.p.id); };
    const hit = mine.filter((l) => !isPitcher(l.p) && l.b.pa >= 120).sort((a, b) => b.war - a.war);
    for (const pos of ['C', '1B', '2B', '3B', 'SS', 'DH']) take(hit.filter((l) => l.p.pos === pos), 2);
    take(hit.filter((l) => OF.includes(l.p.pos as FieldPos)), 6);
    take(hit, 2);
    const sp = mine.filter((l) => l.p.pos === 'SP' && l.s.outs >= 120).sort((a, b) => b.war - a.war);
    const rp = mine.filter((l) => l.p.pos === 'RP' && l.s.outs >= 45).sort((a, b) => b.war - a.war);
    take(sp, 8);
    take(rp, 5);
    // Every club gets at least one.
    for (const org of league.orgs.filter((o) => o.league === lg)) {
      if (mine.some((l) => picked.has(l.p.id) && l.orgId === org.id)) continue;
      const best = mine.filter((l) => l.orgId === org.id && (l.b.pa >= 100 || l.s.outs >= 90)).sort((a, b) => b.war - a.war)[0];
      if (best) picked.add(best.p.id);
    }
    for (const l of mine.filter((x) => picked.has(x.p.id))) give(league, l, 'All-Star', posLabel(l.p));
  }
  const user = league.orgs[league.userOrgId];
  const ours = (league.awards ?? []).filter((a) => a.season === league.season && a.award === 'All-Star' && a.orgId === user.id);
  addNews(league, null, `All-Star rosters announced. The ${user.affiliates.MLB.name} sent ${ours.length}: ${ours.map((a) => pname(league.players[a.pid])).join(', ') || 'nobody'}.`, ours.map((a) => a.pid));
}

// ---------- season awards ----------

function isRookie(p: Player, season: number): boolean {
  let pa = 0;
  let outs = 0;
  for (const e of p.stats) if (e.level === 'MLB' && e.season < season) { pa += e.bat.pa; outs += e.pit.outs; }
  // Service before this season counts too (veterans from before the league began have no stats here).
  return pa < 130 && outs < 150 && p.mlServiceDays - p.serviceThisSeason < 45;
}

const MVP_SCALE = [14, 9, 8, 7, 6, 5, 4, 3, 2, 1];
const CY_SCALE = [7, 4, 3, 2, 1];
const ROY_SCALE = [5, 3, 1];
const VOTERS = 30;

// Each writer ranks the field by how he sees it (the merit score plus his own
// read); points by place decide the award. Returns the winner.
function vote(league: League, lg: 'AL' | 'NL', award: AwardName, field: Line[], merit: (l: Line) => number, scale: number[]): Line | undefined {
  if (!field.length) return undefined;
  const cands = [...field].sort((a, b) => merit(b) - merit(a)).slice(0, scale.length + 8);
  const spread = Math.max(0.4, (merit(cands[0]) - merit(cands[Math.min(cands.length - 1, scale.length)])) / 4);
  const tally = new Map<number, { l: Line; points: number; votes: number[] }>();
  for (let v = 0; v < VOTERS; v++) {
    const ballot = cands.map((l) => ({ l, s: merit(l) + normal(0, spread) })).sort((a, b) => b.s - a.s).slice(0, scale.length);
    ballot.forEach(({ l }, i) => {
      const t = tally.get(l.p.id) ?? { l, points: 0, votes: scale.map(() => 0) };
      t.points += scale[i];
      t.votes[i]++;
      tally.set(l.p.id, t);
    });
  }
  // Most points; ties go to more first-place votes.
  const rows = [...tally.values()].sort((a, b) => b.points - a.points || b.votes[0] - a.votes[0]);
  league.awardVotes ??= [];
  league.awardVotes.push({ season: league.season, award, lg, voters: VOTERS, scale, rows: rows.map((t) => ({ pid: t.l.p.id, orgId: t.l.orgId, pos: posLabel(t.l.p), line: lineOf(t.l), war: Math.round(t.l.war * 10) / 10, points: t.points, votes: t.votes })) });
  return rows[0]?.l;
}

export function seasonAwards(league: League): void {
  const season = league.season;
  if ((league.awards ?? []).some((a) => a.season === season && a.award === 'MVP')) return;
  const ctx = seasonCtx(league, season);
  const lines = seasonLines(league, season);
  const headlines: string[] = [];
  const pids: number[] = [];
  for (const lg of ['AL', 'NL'] as const) {
    const mine = lines.filter((l) => l.lg === lg);
    const qualH = mine.filter((l) => !isPitcher(l.p) && l.b.pa >= 400);
    const qualP = mine.filter((l) => isPitcher(l.p) && (l.s.outs >= 360 || (l.p.pos === 'RP' && l.s.outs >= 150)));
    // The voted awards: 30 writers per league fill out ranked ballots.
    // MVP: WAR (pitchers count a little less), a nudge for playoff clubs.
    const playoff = new Set(league.playoffs ? [...league.playoffs.seeds.AL, ...league.playoffs.seeds.NL] : []);
    const mvp = vote(league, lg, 'MVP', [...qualH, ...qualP], (l) => l.war * (isPitcher(l.p) ? 0.8 : 1) + (playoff.has(l.orgId) ? 0.4 : 0), MVP_SCALE);
    if (mvp) { give(league, mvp, 'MVP'); headlines.push(`${lg} MVP: ${pname(mvp.p)} (${lineOf(mvp)})`); pids.push(mvp.p.id); }
    const cy = vote(league, lg, 'Cy Young', qualP.filter((l) => l.p.pos === 'SP'), (l) => l.war + (l.s.w - 12) * 0.05, CY_SCALE);
    if (cy) { give(league, cy, 'Cy Young'); headlines.push(`${lg} Cy Young: ${pname(cy.p)} (${pitLine(cy)})`); pids.push(cy.p.id); }
    const roy = vote(league, lg, 'Rookie of the Year', mine.filter((l) => isRookie(l.p, season) && (l.b.pa >= 250 || l.s.outs >= 180)), (l) => l.war, ROY_SCALE);
    if (roy) { give(league, roy, 'Rookie of the Year'); headlines.push(`${lg} Rookie of the Year: ${pname(roy.p)}`); pids.push(roy.p.id); }
    const rel = vote(league, lg, 'Reliever of the Year', mine.filter((l) => l.p.pos === 'RP' && l.s.outs >= 150), (l) => l.war + l.s.sv * 0.02, ROY_SCALE);
    if (rel) give(league, rel, 'Reliever of the Year');
    // Gold Gloves: best fielder at each spot among regulars.
    for (const pos of ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'] as FieldPos[]) {
      const gg = qualH.filter((l) => l.p.pos === pos).sort((a, b) => defAt(b.p, pos) - defAt(a.p, pos))[0];
      if (gg) give(league, gg, 'Gold Glove', pos);
    }
    // Silver Sluggers: best wRC+ at each spot (three outfielders).
    const ss = (ls: Line[], n: number, pos: string) => ls.sort((a, b) => batAdvanced(b.b, ctx).wrcPlus - batAdvanced(a.b, ctx).wrcPlus).slice(0, n).forEach((l) => give(league, l, 'Silver Slugger', pos));
    for (const pos of ['C', '1B', '2B', '3B', 'SS', 'DH']) ss(qualH.filter((l) => l.p.pos === pos), 1, pos);
    ss(qualH.filter((l) => OF.includes(l.p.pos as FieldPos)), 3, 'OF');
  }
  addNews(league, null, `Season awards: ${headlines.join('; ')}.`, pids);
  addScoop(league, `Awards: ${headlines.slice(0, 4).join('; ')}.`, pids.slice(0, 4));
  void pitAdvanced;
}

// The season's results, for the archive.
export function archiveSeason(league: League): void {
  league.seasonRecs ??= [];
  if (league.seasonRecs.some((r) => r.season === league.season)) return;
  const st = league.standings.MLB;
  const po = league.playoffs;
  for (const o of league.orgs) {
    let result = '';
    if (po) {
      if (po.champion === o.id) result = 'Won World Series';
      else if (po.seeds.AL.includes(o.id) || po.seeds.NL.includes(o.id)) {
        const lost = po.series.find((s) => s.winner !== null && s.winner !== undefined && s.winner !== o.id && (s.high === o.id || s.low === o.id));
        const names = { WC: 'Wild Card Series', DS: 'Division Series', CS: 'LCS', WS: 'World Series' } as const;
        result = lost ? `Lost ${names[lost.round]}` : 'Playoffs';
      }
    }
    league.seasonRecs.push({ season: league.season, orgId: o.id, w: st[o.id].w, l: st[o.id].l, result });
  }
}

// ---------- Hall of Fame ----------

function career(p: Player) {
  const b = emptyBat();
  const s = emptyPit();
  for (const e of p.stats) if (e.level === 'MLB') {
    for (const k of Object.keys(b) as (keyof BatStats)[]) b[k] += e.bat[k];
    for (const k of Object.keys(s) as (keyof PitStats)[]) s[k] += e.pit[k];
  }
  return { b, s };
}

export function careerWar(league: League, p: Player): number {
  let w = 0;
  for (const e of p.stats) {
    if (e.level !== 'MLB') continue;
    const ctx = seasonCtx(league, e.season);
    w += (isPitcher(p) ? 0 : batWar(p, e.bat, ctx)) + pitWar(e.pit, ctx);
  }
  return w;
}

export function hofScore(league: League, p: Player): { score: number; war: number; line: string } {
  const war = careerWar(league, p);
  const aw = (league.awards ?? []).filter((a) => a.pid === p.id);
  const n = (x: AwardName) => aw.filter((a) => a.award === x).length;
  const { b, s } = career(p);
  let score = war + 8 * n('MVP') + 8 * n('Cy Young') + 1.5 * n('All-Star') + 0.5 * n('Gold Glove') + 0.7 * n('Silver Slugger') + n('Rookie of the Year') + 2 * n('Reliever of the Year');
  if (b.hr >= 500) score += 15;
  if (b.h >= 3000) score += 15;
  if (s.w >= 300) score += 15;
  if (s.k >= 3000) score += 12;
  if (s.sv >= 400) score += 10;
  const line = isPitcher(p)
    ? `${s.w}-${s.l}, ${((s.er * 27) / Math.max(1, s.outs)).toFixed(2)} ERA, ${s.k} K${s.sv ? `, ${s.sv} SV` : ''}`
    : `${fmt3(b.h / Math.max(1, b.ab))}, ${b.h} H, ${b.hr} HR, ${b.rbi} RBI`;
  return { score, war, line: `${line}, ${war.toFixed(1)} WAR${aw.length ? `; ${[...new Set(aw.map((a) => a.award))].map((x) => `${n(x)}x ${x}`).join(', ')}` : ''}` };
}

// Each winter. 75% gets in; under 5% drops off; ten years on the ballot.
export function hallOfFameVote(league: League): void {
  league.hof ??= [];
  league.hofBallot ??= {};
  const inducted: string[] = [];
  const pids: number[] = [];
  for (const p of Object.values(league.players)) {
    if (!p.retired || league.season - p.retired < 5) continue;
    if (league.hof.some((h) => h.pid === p.id)) continue;
    const yrs = (league.hofBallot[p.id] ?? 0) + 1;
    if (yrs > 10 || league.hofBallot[p.id] === -1) continue;
    const { score, war, line } = hofScore(league, p);
    if (yrs === 1 && score < 35) { league.hofBallot[p.id] = -1; continue; }
    // Support builds over time on the ballot.
    const pct = Math.max(0, Math.min(99, 20 + (score - 45) * 2.2 + (yrs - 1) * 2.5));
    if (pct >= 75) {
      league.hof.push({ season: league.season, pid: p.id, pct, war, line, ballot: yrs });
      inducted.push(`${pname(p)} (${pct.toFixed(1)}%${yrs === 1 ? ', first ballot' : `, year ${yrs}`})`);
      pids.push(p.id);
      delete league.hofBallot[p.id];
    } else if (pct < 5) league.hofBallot[p.id] = -1;
    else league.hofBallot[p.id] = yrs;
  }
  if (inducted.length) addNews(league, null, `Hall of Fame: ${inducted.join(', ')} elected.`, pids);
}

export const awardsOf = (league: League, pid: number) => (league.awards ?? []).filter((a) => a.pid === pid);
