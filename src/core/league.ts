// New league creation.
import type { FarmDirector, Level, League, Org, Philosophy, Player, Pos, StandingRow } from './types.ts';
import { LEVELS, MINOR_LEVELS } from './types.ts';
import { ORG_DEFS, buildAffiliates } from './teams.ts';
import { defaultSettings } from './settings.ts';
import { generatePlayer } from './playerGen.ts';
import { clamp, normal, rand, randInt, choice } from './random.ts';
import { initialMLContract, milbContract, roundSalary } from './contracts.ts';
import { ovr, potOvr } from './ratings.ts';
import { buildSchedule } from './schedule.ts';
import { randomStaffName } from './names.ts';

const MLB_HITTERS: Pos[] = ['C', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'SS', 'CF', '3B'];
const MINOR_HITTERS: Pos[] = ['C', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', '1B', 'SS', '2B', 'CF', 'RF'];

const COMPOSITION: Record<Level, { sp: number; rp: number; hitters: Pos[] }> = {
  MLB: { sp: 5, rp: 8, hitters: MLB_HITTERS },
  AAA: { sp: 6, rp: 8, hitters: MINOR_HITTERS },
  AA: { sp: 6, rp: 8, hitters: MINOR_HITTERS },
  'A+': { sp: 7, rp: 8, hitters: [...MINOR_HITTERS, '3B'] },
  A: { sp: 7, rp: 8, hitters: [...MINOR_HITTERS, 'LF'] },
  CPX: { sp: 8, rp: 10, hitters: [...MINOR_HITTERS, 'C', '3B', 'LF'] },
  DSL: { sp: 8, rp: 10, hitters: [...MINOR_HITTERS, 'C', 'SS', 'CF'] },
};

export const emptyStanding = (): StandingRow => ({ w: 0, l: 0, rs: 0, ra: 0, streak: 0, last10: '' });

export function makeFarmDirector(id: number, orgId: number | null): FarmDirector {
  const { first, last } = randomStaffName();
  const development = clamp(Math.round(normal(50, 10)), 25, 80);
  const evaluation = clamp(Math.round(normal(50, 10)), 25, 80);
  const philosophy: Philosophy = choice(['Conservative', 'Balanced', 'Balanced', 'Aggressive']);
  return {
    id,
    first,
    last,
    age: randInt(34, 68),
    development,
    evaluation,
    philosophy,
    salary: roundSalary(200_000 + (development + evaluation - 80) * 9_000 + rand() * 60_000),
    exp: 0,
    orgId,
  };
}

export interface NewLeagueOptions {
  name: string;
  userOrgIndex: number;
  season: number;
}

export function createLeague(opts: NewLeagueOptions): League {
  const settings = defaultSettings();
  const season = opts.season;
  const affiliates = buildAffiliates(ORG_DEFS);
  const orgs: Org[] = ORG_DEFS.map((d, i) => ({
    id: i,
    region: d.region,
    name: d.name,
    abbrev: d.abbrev,
    league: d.league,
    div: d.div,
    affiliates: affiliates[i],
    farmDirectorId: null,
    control: { MLB: 'Manual', AAA: 'FD', AA: 'FD', 'A+': 'FD', A: 'FD', CPX: 'FD', DSL: 'FD' },
    depth: {},
    rotationIndex: {},
    cbtPayerYears: 0,
    deadMoney: [],
  }));

  const players: Record<number, Player> = {};
  let pid = 1;

  for (const org of orgs) {
    const market = ORG_DEFS[org.id].market;
    const mlbShift = normal(0, 2.2) + (market - 1) * 3;
    const farmShift = normal(0, 1.4);
    for (const level of LEVELS) {
      const comp = COMPOSITION[level];
      const positions: Pos[] = [
        ...Array<Pos>(comp.sp).fill('SP'),
        ...Array<Pos>(comp.rp).fill('RP'),
        ...comp.hitters,
      ];
      for (const pos of positions) {
        const p = generatePlayer({
          id: pid++,
          season,
          level,
          orgId: org.id,
          pos,
          talentShift: level === 'MLB' ? mlbShift : farmShift,
        });
        players[p.id] = p;
      }
    }
  }

  // Service time and 40-man rosters.
  const s = settings;
  for (const org of orgs) {
    const mine = Object.values(players).filter((p) => p.orgId === org.id);
    for (const p of mine) {
      const a = season - p.born;
      if (p.level === 'MLB') {
        const yrs = clamp(Math.round(a - 23.5 + normal(0, 1.5)), 0, 18);
        p.mlServiceDays = yrs * s.serviceDaysPerYear + randInt(0, s.serviceDaysPerYear - 1);
        if (a <= 23) p.mlServiceDays = randInt(0, 300);
        p.on40 = true;
        p.optionsUsed = clamp(Math.round(rand() * 3 * Math.min(1, yrs / 4)), 0, 3);
      }
    }
    // Fill the rest of the 40-man with the best upper-minors prospects and depth.
    const candidates = mine
      .filter((p) => p.level === 'AAA' || p.level === 'AA' || p.level === 'A+')
      .filter((p) => season - p.born >= 21)
      .sort((x, y) => 0.5 * ovr(y) + 0.5 * potOvr(y) - (0.5 * ovr(x) + 0.5 * potOvr(x)));
    const slots = s.fortyMax - mine.filter((p) => p.on40).length;
    for (const p of candidates.slice(0, slots)) {
      p.on40 = true;
      const a = season - p.born;
      if (p.level === 'AAA' && a >= 25 && rand() < 0.4) {
        p.mlServiceDays = randInt(5, 400);
        p.optionsUsed = randInt(1, 2);
      } else {
        p.optionsUsed = p.level === 'AAA' ? randInt(0, 1) : 0;
      }
    }
    for (const p of mine) {
      if (p.on40) initialMLContract(p, season, s);
      else milbContract(p, season, p.level as Level);
      if (p.mlServiceDays > 0 && p.level !== 'MLB' && !p.on40) p.outrightedBefore = rand() < 0.5;
    }
  }

  // Farm directors: one per org plus an unemployed pool you can hire from.
  const farmDirectors: FarmDirector[] = [];
  let sid = 1;
  for (const org of orgs) {
    const fd = makeFarmDirector(sid++, org.id);
    fd.exp = season + randInt(0, 3);
    farmDirectors.push(fd);
    org.farmDirectorId = fd.id;
  }
  for (let i = 0; i < 16; i++) farmDirectors.push(makeFarmDirector(sid++, null));

  // A small pool of free agents (released vets, unsigned minor leaguers).
  for (let i = 0; i < 90; i++) {
    const lvl = choice<Level>(['AAA', 'AAA', 'AA', 'A+']);
    const p = generatePlayer({ id: pid++, season, level: lvl, orgId: null, talentShift: -2 });
    p.level = null;
    const a = season - p.born;
    if (a >= 26) p.mlServiceDays = rand() < 0.5 ? randInt(10, 900) : 0;
    milbContract(p, season, lvl);
    players[p.id] = p;
  }

  const schedule = buildSchedule(orgs, settings, 1);
  const standings = {} as League['standings'];
  for (const level of LEVELS) {
    standings[level] = {};
    for (const org of orgs) standings[level][org.id] = emptyStanding();
  }

  const league: League = {
    version: 1,
    id: `l${Date.now().toString(36)}${Math.floor(rand() * 1e4).toString(36)}`,
    name: opts.name,
    created: Date.now(),
    startYear: season,
    season,
    phase: 'regular',
    day: 0,
    userOrgId: opts.userOrgIndex,
    settings,
    orgs,
    players,
    farmDirectors,
    schedule,
    standings,
    transactions: [],
    news: [],
    boxScores: {},
    playoffs: null,
    champions: [],
    nextId: { player: pid, game: schedule.length + 1, tx: 1, news: 1, staff: sid },
    lastFdRun: -99,
    waiverClaims: {},
    lastDevDay: 0,
  };
  return league;
}

export { MINOR_LEVELS };
