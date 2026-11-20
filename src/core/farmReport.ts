// The farm director's weekly report: who's hot, how the top prospects did,
// who's struggling, and who he thinks is ready to move up.
import type { FarmReport, League, Level, Player } from './types.ts';
import { addInbox } from './morale.ts';
import { MINOR_LEVELS } from './types.ts';
import { isPitcher, ovr, perceivedOvr, posRating, potOvr, scout } from './ratings.ts';
import type { FieldPos } from './types.ts';
import { LEVEL_AGE } from './settings.ts';
import { addNews, orgPlayers, pname } from './util.ts';
import { staffOf } from './staff.ts';

// Cumulative minor league totals: [pa, ab, h, 2b, 3b, hr, bb, hbp, sf, sb, outs, er, k(p), bb(p), h(p)]
type Snap = number[];

function totals(league: League, p: Player): Snap {
  const t = new Array(15).fill(0);
  for (const e of p.stats) {
    if (e.season !== league.season || e.level === 'MLB' || e.orgId !== p.orgId) continue;
    const b = e.bat;
    const q = e.pit;
    const add = [b.pa, b.ab, b.h, b.d, b.t, b.hr, b.bb, b.hbp, b.sf, b.sb, q.outs, q.er, q.k, q.bb, q.h];
    for (let i = 0; i < 15; i++) t[i] += add[i];
  }
  return t;
}

const ops = (s: Snap) => {
  const [pa, ab, h, d, t, hr, bb, hbp, sf] = s;
  void pa;
  const obp = ab + bb + hbp + sf ? (h + bb + hbp) / (ab + bb + hbp + sf) : 0;
  const slg = ab ? (h + d + 2 * t + 3 * hr) / ab : 0;
  return obp + slg;
};
const era = (s: Snap) => (s[10] ? (s[11] * 27) / s[10] : 0);
const ip = (outs: number) => `${Math.floor(outs / 3)}${outs % 3 ? `.${outs % 3}` : ''}`;
const batLine = (s: Snap) => `${s[2]}-for-${s[1]}${s[5] ? `, ${s[5]} HR` : ''}${s[3] ? `, ${s[3]} 2B` : ''}${s[6] ? `, ${s[6]} BB` : ''}${s[9] ? `, ${s[9]} SB` : ''}`;
const pitLine = (s: Snap) => `${ip(s[10])} IP, ${s[11]} ER, ${s[12]} K, ${s[13]} BB`;
const where = (league: League, p: Player) => `${p.pos === 'SP' || p.pos === 'RP' ? (p.throws === 'L' ? 'LHP' : 'RHP') : p.pos} ${pname(p)} (${p.level}, ${league.season - p.born})`;

// Ratings the report tracks, with the same scouting keys as the player page.
function trackedRatings(p: Player): { key: string; label: string; v: number }[] {
  if (isPitcher(p)) {
    const r = p.ratings.pit;
    return [
      { key: 'stuff', label: 'Stuff', v: r.stuff },
      { key: 'mov', label: 'Movement', v: r.movement },
      { key: 'ctl', label: 'Control', v: r.control },
      { key: 'stam', label: 'Stamina', v: r.stamina },
    ];
  }
  const b = p.ratings.vR;
  const out = [
    { key: 'vR-babip', label: 'Hit quality', v: b.babip },
    { key: 'vR-avoidK', label: 'Bat-to-ball', v: b.avoidK },
    { key: 'vR-gap', label: 'Gap power', v: b.gap },
    { key: 'vR-power', label: 'Power', v: b.power },
    { key: 'vR-eye', label: 'Eye', v: b.eye },
    { key: 'spd', label: 'Speed', v: p.ratings.run.speed },
  ];
  if (p.pos !== 'DH') out.push({ key: `pos-${p.pos}`, label: `${p.pos} defense`, v: posRating(p.ratings.def, p.pos as FieldPos) });
  return out;
}

export function weeklyFarmReport(league: League): void {
  const org = league.orgs[league.userOrgId];
  const fd = staffOf(league, org, 'FD');
  if (!fd) return;
  // Totals restart each season.
  if (!league.farmSnap || league.farmSnap.season !== league.season) league.farmSnap = { season: league.season, totals: {} };
  const sd = Math.max(0, ((80 - fd.evaluation) / 60) * 5);
  const minors = orgPlayers(league, org.id).filter((p) => p.level && (MINOR_LEVELS as Level[]).includes(p.level) && !p.retired);
  const week = new Map<number, Snap>();
  const season = new Map<number, Snap>();
  for (const p of minors) {
    const now = totals(league, p);
    const prev = league.farmSnap.totals[p.id] ?? new Array(15).fill(0);
    week.set(p.id, now.map((v, i) => v - (prev[i] ?? 0)));
    season.set(p.id, now);
  }
  // Fresh snapshot for next week (only this org's minor leaguers).
  league.farmSnap = { season: league.season, totals: Object.fromEntries(minors.map((p) => [p.id, season.get(p.id)!])) };
  if (![...week.values()].some((w) => w[0] > 0 || w[10] > 0)) return; // nobody played this week

  const hitters = minors.filter((p) => !isPitcher(p));
  const pitchers = minors.filter(isPitcher);
  const sections: FarmReport['sections'] = [];

  // Player of the week.
  const hot = hitters.filter((p) => week.get(p.id)![0] >= 15).sort((a, b) => ops(week.get(b.id)!) - ops(week.get(a.id)!))[0];
  const ace = pitchers
    .filter((p) => week.get(p.id)![10] >= 9)
    .sort((a, b) => {
      const sa = week.get(a.id)!;
      const sb = week.get(b.id)!;
      return sb[10] - 3 * sb[11] + sb[12] - (sa[10] - 3 * sa[11] + sa[12]);
    })[0];
  const pow: FarmReport['sections'][0]['lines'] = [];
  if (hot) pow.push({ text: `Hitter of the week: ${where(league, hot)} went ${batLine(week.get(hot.id)!)}.`, pids: [hot.id] });
  if (ace) pow.push({ text: `Pitcher of the week: ${where(league, ace)}: ${pitLine(week.get(ace.id)!)}.`, pids: [ace.id] });
  if (pow.length) sections.push({ title: 'Players of the week', lines: pow });

  // Top prospects, as the farm director ranks them.
  const rank = (p: Player) => 0.7 * (potOvr(p) + (perceivedOvr(league, p, sd) - ovr(p))) + 0.3 * perceivedOvr(league, p, sd) - (league.season - p.born) * 0.3;
  const top = [...minors].sort((a, b) => rank(b) - rank(a)).slice(0, 10);
  const tops = top
    .map((p) => {
      const w = week.get(p.id)!;
      const line = isPitcher(p) ? (w[10] ? pitLine(w) : 'did not pitch') : w[0] ? batLine(w) : 'did not play';
      return { text: `${where(league, p)}: ${line}.${p.injury ? ` Injured (${p.injury.name}).` : ''}`, pids: [p.id] };
    });
  if (tops.length) sections.push({ title: 'Top prospects this week', lines: tops });

  // Struggling.
  const cold = top.filter((p) => {
    const s = season.get(p.id)!;
    return isPitcher(p) ? s[10] >= 60 && era(s) >= 6 : s[0] >= 80 && ops(s) < 0.6;
  });
  if (cold.length) {
    sections.push({
      title: 'Struggling',
      lines: cold.map((p) => {
        const s = season.get(p.id)!;
        return { text: `${where(league, p)} is ${isPitcher(p) ? `at a ${era(s).toFixed(2)} ERA over ${ip(s[10])} innings` : `hitting for a ${ops(s).toFixed(3).replace(/^0/, '')} OPS in ${s[0]} PA`}. I'd be patient${isPitcher(p) ? ' with his workload' : ''}, or think about moving him down a level.`, pids: [p.id] };
      }),
    });
  }

  // Ready to move up: dominating the level and not old for it.
  const ready = minors.filter((p) => {
    const s = season.get(p.id)!;
    const young = league.season - p.born <= LEVEL_AGE[p.level!] + 1.5;
    const dominating = isPitcher(p) ? s[10] >= 120 && era(s) <= 2.75 && s[12] >= 2.5 * Math.max(1, s[13]) : s[0] >= 120 && ops(s) >= 0.88;
    return young && dominating && potOvr(p) >= 45;
  });
  if (ready.length) {
    sections.push({
      title: 'Ready for a promotion',
      lines: ready.slice(0, 6).map((p) => {
        const s = season.get(p.id)!;
        const next = p.level === 'AAA' ? 'the majors' : p.level === 'AA' ? 'AAA' : p.level === 'A+' ? 'AA' : p.level === 'A' ? 'A+' : p.level === 'CPX' ? 'A' : 'the complex league';
        const manual = org.control[p.level!] === 'Manual' ? ' (you run this level)' : '';
        return { text: `${where(league, p)} has nothing left to prove: ${isPitcher(p) ? `${era(s).toFixed(2)} ERA, ${s[12]} K in ${ip(s[10])} IP` : `${ops(s).toFixed(3).replace(/^0/, '')} OPS, ${s[5]} HR in ${s[0]} PA`}. I'd move him to ${next}${manual}.`, pids: [p.id] };
      }),
    });
  }

  // Development: rating changes since the start of the season, reported after
  // each monthly development pass (ratings move about once a month).
  if (!league.devSnap || league.devSnap.season !== league.season) league.devSnap = { season: league.season, ratings: {} };
  const snap = league.devSnap.ratings;
  const dev: { p: Player; ups: string[]; downs: string[]; size: number }[] = [];
  const topIds = new Set(top.map((p) => p.id));
  for (const p of minors) {
    const now = trackedRatings(p);
    const before = snap[p.id];
    if (!before) {
      snap[p.id] = now.map((r) => r.v); // baseline for players new to the system
      continue;
    }
    if (league.day - league.lastDevDay >= 7) continue;
    const ups: string[] = [];
    const downs: string[] = [];
    let size = 0;
    now.forEach((r, i) => {
      const was = before[i];
      if (was === undefined || Math.abs(r.v - was) < 1.2) return;
      const g0 = scout(league, p, r.key, was);
      const g1 = scout(league, p, r.key, r.v);
      if (g0 === g1) return;
      size += Math.abs(r.v - was);
      (r.v > was ? ups : downs).push(`${r.label} ${g0} → ${g1}`);
    });
    if (ups.length || downs.length) dev.push({ p, ups, downs, size: size + (topIds.has(p.id) ? 10 : 0) });
  }
  if (dev.length) {
    dev.sort((a, b) => b.size - a.size);
    sections.push({
      title: 'Development since Opening Day',
      lines: dev.slice(0, 12).map(({ p, ups, downs }) => {
        const verdict = ups.length && !downs.length ? 'is making progress' : downs.length && !ups.length ? 'has slipped' : 'is a mixed bag';
        const parts = [ups.length ? `up: ${ups.join(', ')}` : '', downs.length ? `down: ${downs.join(', ')}` : ''].filter(Boolean).join('; ');
        return { text: `${where(league, p)} ${verdict} (${parts}).`, pids: [p.id] };
      }),
    });
  }

  if (!sections.length) return;
  const report: FarmReport = { season: league.season, day: league.day, by: `${fd.first} ${fd.last}`, sections };
  league.farmReports = [...(league.farmReports ?? []), report].slice(-30);
  addInbox(league, { from: `Farm director ${fd.first} ${fd.last}`, subject: 'Weekly farm report', kind: 'info', pids: [], text: 'This week\'s farm report is in: standouts, top prospects, players struggling and who looks ready.', link: { page: 'farm-reports' }, read: false });
  addNews(league, org.id, `Farm director ${fd.first} ${fd.last} filed his weekly report${hot ? `: ${pname(hot)} was his hitter of the week` : ''}${ace ? `${hot ? ' and' : ':'} ${pname(ace)} his pitcher of the week` : ''}. See Farm Reports.`, [hot?.id, ace?.id].filter((x): x is number => x !== undefined));
}
