// Advances the league one day: plays every game at every level, records
// stats and standings, then runs injuries, service time, options, waivers and
// organizational AI.
import type { Game, League, Level, PlayoffSeries } from '../types.ts';
import { LEVELS } from '../types.ts';
import { buildLineup, pickStarter } from './lineup.ts';
import { simGame } from './game.ts';
import { activeAt, activeLimit, addNews, countPitchers, fortyMan, orgById, pitcherLimit, pname, statEntry } from '../util.ts';
import { farmDirectorReview, isManaged, manageOrg } from '../farmDirector.ts';
import { resolveWaivers } from '../rules.ts';
import { monthlyDevelopment } from '../development.ts';
import { isPitcher } from '../ratings.ts';

let dayIndex: Map<number, Game[]> | null = null;
let indexedFor: Game[] | null = null;

function gamesOn(league: League, day: number): Game[] {
  if (indexedFor !== league.schedule) {
    dayIndex = new Map();
    for (const g of league.schedule) {
      const arr = dayIndex.get(g.day);
      if (arr) arr.push(g);
      else dayIndex.set(g.day, [g]);
    }
    indexedFor = league.schedule;
  }
  return dayIndex!.get(day) ?? [];
}

export function invalidateScheduleIndex(): void {
  indexedFor = null;
}

// Problems that must be fixed before the user's club can play.
export function userRosterIssues(league: League): string[] {
  const issues: string[] = [];
  const org = league.userOrgId;
  const active = activeAt(league, org, 'MLB');
  const lim = activeLimit(league);
  if (active.length > lim) issues.push(`MLB active roster has ${active.length} players (max ${lim}).`);
  if (active.length < lim - 1) issues.push(`MLB active roster has ${active.length} players (needs ${lim}).`);
  const pc = countPitchers(active);
  if (pc > pitcherLimit(league)) issues.push(`MLB roster has ${pc} pitchers (max ${pitcherLimit(league)}).`);
  if (pc < 9) issues.push(`MLB roster has only ${pc} pitchers.`);
  if (active.filter((p) => !isPitcher(p) && !p.injury).length < 9) issues.push('Not enough healthy position players on the MLB roster.');
  const f = fortyMan(league, org).length;
  if (f > league.settings.fortyMax) issues.push(`40-man roster has ${f} players (max ${league.settings.fortyMax}).`);
  for (const p of active) if (p.injury) issues.push(`${pname(p)} is injured (${p.injury.daysLeft} days) and still on the active roster.`);
  for (const level of LEVELS) {
    if (level === 'MLB' || isManaged(league, league.orgs[org], level)) continue;
    const n = activeAt(league, org, level).length;
    const max = league.settings.milbActiveMax[level];
    if (n > max) issues.push(`${level} roster has ${n} players (max ${max}).`);
  }
  return issues;
}

function updateStanding(league: League, level: Level, orgId: number, won: boolean, rs: number, ra: number) {
  const r = league.standings[level][orgId];
  if (won) r.w++;
  else r.l++;
  r.rs += rs;
  r.ra += ra;
  r.streak = won ? (r.streak > 0 ? r.streak + 1 : 1) : r.streak < 0 ? r.streak - 1 : -1;
  r.last10 = (r.last10 + (won ? 'W' : 'L')).slice(-10);
}

function playGame(league: League, g: Game, recordStats: boolean): void {
  const spHome = pickStarter(league, g.home, g.level, activeAt(league, g.home, g.level).filter((p) => isPitcher(p) && !p.injury), league.orgs[g.home].depth[g.level]);
  const spAway = pickStarter(league, g.away, g.level, activeAt(league, g.away, g.level).filter((p) => isPitcher(p) && !p.injury), league.orgs[g.away].depth[g.level]);
  const home = buildLineup(league, g.home, g.level, spAway?.throws ?? 'R', spHome ?? undefined);
  const away = buildLineup(league, g.away, g.level, spHome?.throws ?? 'R', spAway ?? undefined);
  if (!home || !away || home.batters.length < 9 || away.batters.length < 9) {
    // Forfeit-style result if a club cannot field a team (should be rare).
    const homeWins = !!home && home.batters.length >= 9;
    g.result = { hs: homeWins ? 9 : 0, as: homeWins ? 0 : 9, innings: 9, wp: null, lp: null, sv: null };
    if (recordStats) {
      updateStanding(league, g.level, g.home, homeWins, g.result.hs, g.result.as);
      updateStanding(league, g.level, g.away, !homeWins, g.result.as, g.result.hs);
    }
    return;
  }
  const out = simGame(home, away, { gid: g.id, day: league.day, injuryRate: league.settings.injuryRate, ghostRunner: league.settings.extraInningRunner });
  g.result = { hs: out.homeRuns, as: out.awayRuns, innings: out.innings, wp: out.wp, lp: out.lp, sv: out.sv };
  if (recordStats) {
    updateStanding(league, g.level, g.home, out.homeRuns > out.awayRuns, out.homeRuns, out.awayRuns);
    updateStanding(league, g.level, g.away, out.awayRuns > out.homeRuns, out.awayRuns, out.homeRuns);
    for (const { p, orgId, line } of out.batLines) {
      const e = statEntry(p, league.season, g.level, orgId).bat;
      for (const k in line) e[k as keyof typeof line] += line[k as keyof typeof line];
    }
    for (const { p, orgId, line } of out.pitLines) {
      const e = statEntry(p, league.season, g.level, orgId).pit;
      for (const k in line) e[k as keyof typeof line] += line[k as keyof typeof line];
    }
  }
  for (const { p, line, isStarter } of out.pitLines) {
    p.consecutiveDays = p.lastPitchedDay === league.day - 1 ? p.consecutiveDays + 1 : 1;
    p.lastPitchedDay = league.day;
    p.lastPitchCount = line.pitches;
    if (isStarter) p.lastStartDay = league.day;
  }
  for (const inj of out.injuries) {
    const p = inj.p;
    if (!p.injury || p.injury.daysLeft < inj.days) p.injury = { name: inj.name, daysLeft: inj.days, totalDays: inj.days };
    if (p.orgId === league.userOrgId) {
      addNews(league, p.orgId, `${pname(p)} (${p.level}) was injured: ${inj.name}, out about ${inj.days} days.`, [p.id]);
    }
  }
  if (g.home === league.userOrgId || g.away === league.userOrgId || g.playoff) league.boxScores[g.id] = out.box;
}

function dailyUpkeep(league: League): void {
  const s = league.settings;
  const inSeason = league.phase === 'regular';
  for (const p of Object.values(league.players)) {
    if (p.injury) {
      p.injury.daysLeft--;
      if (p.injury.daysLeft <= 0) {
        p.injury = null;
        if (p.orgId === league.userOrgId && p.il) addNews(league, p.orgId, `${pname(p)} is healthy and can be activated from the IL.`, [p.id]);
      }
    }
    if (p.orgId === null || !inSeason) continue;
    // Service time: MLB active roster or MLB injured list.
    const onMlb = p.on40 && ((p.level === 'MLB' && !p.dfa && !p.waivers) || (p.il !== null && p.il.type.startsWith('IL')));
    if (onMlb && p.serviceThisSeason < s.serviceDaysPerYear) {
      p.serviceThisSeason++;
      p.mlServiceDays++;
    }
    // Option years are charged after 20 days on optional assignment in a season.
    if (p.on40 && p.level !== 'MLB' && p.optionedOnDay !== null && !p.il) {
      p.optionDaysThisSeason++;
      if (p.optionDaysThisSeason === s.optionDaysToUseYear) p.optionsUsed++;
    }
  }
  // Waivers that have run their course.
  for (const p of Object.values(league.players)) {
    if (p.waivers && league.day - p.waivers.day >= s.waiverDays) resolveWaivers(league, p);
  }
  for (const org of league.orgs) manageOrg(league, org);
  if (league.day - league.lastFdRun >= 7) {
    for (const org of league.orgs) farmDirectorReview(league, org);
    league.lastFdRun = league.day;
  }
  if (inSeason && league.day - league.lastDevDay >= 30) {
    monthlyDevelopment(league);
    league.lastDevDay = league.day;
  }
}

// ---------- playoffs ----------

function seedLeague(league: League, lg: 'AL' | 'NL'): number[] {
  const st = league.standings.MLB;
  const pct = (id: number) => st[id].w / Math.max(1, st[id].w + st[id].l);
  const tie = (id: number) => st[id].rs - st[id].ra;
  const orgs = league.orgs.filter((o) => o.league === lg);
  const winners = (['East', 'Central', 'West'] as const).map((d) => orgs.filter((o) => o.div === d).sort((a, b) => pct(b.id) - pct(a.id) || tie(b.id) - tie(a.id))[0].id);
  winners.sort((a, b) => pct(b) - pct(a) || tie(b) - tie(a));
  const wc = orgs
    .map((o) => o.id)
    .filter((id) => !winners.includes(id))
    .sort((a, b) => pct(b) - pct(a) || tie(b) - tie(a))
    .slice(0, 3);
  return [...winners, ...wc];
}

function startPlayoffs(league: League): void {
  const AL = seedLeague(league, 'AL');
  const NL = seedLeague(league, 'NL');
  const series: PlayoffSeries[] = [];
  for (const [lg, seeds] of [['AL', AL], ['NL', NL]] as const) {
    series.push({ id: `${lg}-WC1`, round: 'WC', league: lg, high: seeds[2], low: seeds[5], wins: [0, 0], bestOf: 3, winner: null });
    series.push({ id: `${lg}-WC2`, round: 'WC', league: lg, high: seeds[3], low: seeds[4], wins: [0, 0], bestOf: 3, winner: null });
  }
  league.playoffs = { seeds: { AL, NL }, series, champion: null };
  league.phase = 'playoffs';
  // Minor league regular season champions (best record).
  for (const level of LEVELS) {
    if (level === 'MLB') continue;
    const st = league.standings[level];
    const best = Object.keys(st).map(Number).sort((a, b) => st[b].w - st[a].w || st[b].rs - st[b].ra - (st[a].rs - st[a].ra))[0];
    league.champions.push({ season: league.season, level, orgId: best });
  }
  addNews(league, null, `The ${league.season} regular season is over. Playoffs begin.`);
}

const HOME_PATTERN: Record<number, boolean[]> = {
  3: [true, true, true],
  5: [true, true, false, false, true],
  7: [true, true, false, false, false, true, true],
};

function advancePlayoffRounds(league: League): void {
  const po = league.playoffs!;
  for (const lg of ['AL', 'NL'] as const) {
    const seeds = po.seeds[lg];
    const of = (round: string) => po.series.filter((x) => x.league === lg && x.round === round);
    const wc = of('WC');
    if (wc.length && wc.every((x) => x.winner !== null) && of('DS').length === 0) {
      const w1 = wc.find((x) => x.id.endsWith('WC1'))!.winner!; // winner of 3 v 6 plays 2
      const w2 = wc.find((x) => x.id.endsWith('WC2'))!.winner!; // winner of 4 v 5 plays 1
      po.series.push({ id: `${lg}-DS1`, round: 'DS', league: lg, high: seeds[0], low: w2, wins: [0, 0], bestOf: 5, winner: null });
      po.series.push({ id: `${lg}-DS2`, round: 'DS', league: lg, high: seeds[1], low: w1, wins: [0, 0], bestOf: 5, winner: null });
    }
    const ds = of('DS');
    if (ds.length && ds.every((x) => x.winner !== null) && of('CS').length === 0) {
      const a = ds[0].winner!;
      const b = ds[1].winner!;
      const [hi, lo] = seeds.indexOf(a) < seeds.indexOf(b) ? [a, b] : [b, a];
      po.series.push({ id: `${lg}-CS`, round: 'CS', league: lg, high: hi, low: lo, wins: [0, 0], bestOf: 7, winner: null });
    }
  }
  const al = po.series.find((x) => x.id === 'AL-CS');
  const nl = po.series.find((x) => x.id === 'NL-CS');
  if (al?.winner != null && nl?.winner != null && !po.series.some((x) => x.round === 'WS')) {
    const st = league.standings.MLB;
    const a = al.winner;
    const b = nl.winner;
    const [hi, lo] = st[a].w >= st[b].w ? [a, b] : [b, a];
    po.series.push({ id: 'WS', round: 'WS', league: 'MLB', high: hi, low: lo, wins: [0, 0], bestOf: 7, winner: null });
  }
}

function playoffDay(league: League): void {
  const po = league.playoffs!;
  advancePlayoffRounds(league);
  for (const sr of po.series) {
    if (sr.winner !== null) continue;
    const gameNo = sr.wins[0] + sr.wins[1];
    const highHome = HOME_PATTERN[sr.bestOf][gameNo];
    const g: Game = {
      id: league.nextId.game++,
      level: 'MLB',
      day: league.day,
      home: highHome ? sr.high : sr.low,
      away: highHome ? sr.low : sr.high,
      result: null,
      playoff: { round: sr.round, game: gameNo + 1 },
    };
    league.schedule.push(g);
    invalidateScheduleIndex();
    playGame(league, g, false);
    const highWon = (g.home === sr.high) === g.result!.hs > g.result!.as;
    sr.wins[highWon ? 0 : 1]++;
    const need = Math.ceil(sr.bestOf / 2);
    if (sr.wins[0] >= need || sr.wins[1] >= need) {
      sr.winner = sr.wins[0] >= need ? sr.high : sr.low;
      const w = orgById(league, sr.winner)!;
      const l = orgById(league, sr.winner === sr.high ? sr.low : sr.high)!;
      addNews(league, null, `${w.affiliates.MLB.name} beat the ${l.affiliates.MLB.name} ${Math.max(...sr.wins)}-${Math.min(...sr.wins)} (${sr.round === 'WS' ? 'World Series' : `${sr.league} ${sr.round}`}).`);
      if (sr.round === 'WS') {
        po.champion = sr.winner;
        league.champions.push({ season: league.season, level: 'MLB', orgId: sr.winner });
        league.phase = 'offseason';
        addNews(league, null, `The ${w.affiliates.MLB.name} won the ${league.season} World Series!`);
      }
    }
  }
}

export interface DayResult {
  stop: string | null;
}

export function simOneDay(league: League): DayResult {
  if (league.phase === 'offseason') return { stop: 'The season is over. The offseason (arbitration, free agency, the draft, Rule 5) is coming in the next milestone.' };
  if (league.phase === 'regular') {
    {
      // With auto moves on, the assistant fixes the MLB roster; anything left is the user's to fix.
      if (league.settings.autoMlbMoves) manageOrg(league, league.orgs[league.userOrgId]);
      const issues = userRosterIssues(league).filter((i) => !league.settings.autoMlbMoves || !i.startsWith('MLB active roster has') || i.includes('max'));
      if (issues.length && !league.settings.autoMlbMoves) return { stop: issues.join(' ') };
      if (issues.some((i) => i.includes('(max'))) return { stop: issues.join(' ') };
    }
    // Clubs fix their rosters (including moves the user just made) before first pitch.
    for (const org of league.orgs) manageOrg(league, org);
    const games = gamesOn(league, league.day);
    for (const g of games) if (!g.result) playGame(league, g, true);
    dailyUpkeep(league);
    league.day++;
    const remaining = league.schedule.some((g) => g.level === 'MLB' && !g.result && !g.playoff);
    if (!remaining && league.day >= league.settings.seasonDays - 1) startPlayoffs(league);
    return { stop: null };
  }
  playoffDay(league);
  dailyUpkeep(league);
  league.day++;
  return { stop: null };
}

export function nextUserGameDay(league: League): number | null {
  for (let d = league.day; d < league.day + 30; d++) {
    if (gamesOn(league, d).some((g) => g.level === 'MLB' && (g.home === league.userOrgId || g.away === league.userOrgId))) return d;
  }
  return null;
}

