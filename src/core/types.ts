// Core data types. Everything here is plain JSON so a league can be saved,
// exported and imported without conversion.

export type Level = 'MLB' | 'AAA' | 'AA' | 'A+' | 'A' | 'CPX' | 'DSL';
export const LEVELS: Level[] = ['MLB', 'AAA', 'AA', 'A+', 'A', 'CPX', 'DSL'];
export const MINOR_LEVELS: Level[] = ['AAA', 'AA', 'A+', 'A', 'CPX', 'DSL'];

export type FieldPos = 'C' | '1B' | '2B' | '3B' | 'SS' | 'LF' | 'CF' | 'RF';
export type Pos = FieldPos | 'DH' | 'SP' | 'RP';
export const FIELD_POS: FieldPos[] = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];

export type Hand = 'L' | 'R' | 'S';

// All ratings are on the 20-80 scouting scale (internally floats, may drift slightly past the ends).
export interface BatSplit {
  babip: number;
  avoidK: number;
  gap: number;
  power: number;
  eye: number;
}

export interface RunRatings {
  speed: number;
  steal: number;
  baserunning: number;
}

export interface DefRatings {
  cAbil: number;
  cArm: number;
  ifRange: number;
  ifErr: number;
  ifArm: number;
  tdp: number;
  ofRange: number;
  ofErr: number;
  ofArm: number;
}

export type PitchType = 'FB' | 'SI' | 'CT' | 'SL' | 'SW' | 'CB' | 'CH' | 'SP' | 'KN';

export interface PitchRatings {
  stuff: number;
  movement: number;
  control: number;
  stamina: number;
  gb: number; // groundball tendency, 50 = league average
  velo: number; // typical fastball velocity, mph
  pitches: Partial<Record<PitchType, number>>;
}

export interface Personality {
  workEthic: number;
  intelligence: number;
  leadership: number;
  loyalty: number;
  greed: number;
  winning: number;
}

export interface Ratings {
  vL: BatSplit;
  vR: BatSplit;
  run: RunRatings;
  def: DefRatings;
  pit: PitchRatings;
}

export interface Potential {
  bat: BatSplit; // overall (both sides) batting potential
  stuff: number;
  movement: number;
  control: number;
  stamina: number;
  speed: number;
  def: DefRatings;
}

export type ContractType = 'ML' | 'MiLB';

export interface Contract {
  type: ContractType;
  salary: number; // annual MLB salary (dollars). For MiLB deals this is the minor league salary.
  minorSalary: number; // salary while in the minors (split ML contracts)
  exp: number; // last season of the contract
  oneWay: boolean; // one-way ML contracts pay the MLB salary even in the minors
  signed: number; // season signed
}

export interface IlStatus {
  type: 'IL10' | 'IL15' | 'IL60' | 'MiLB7' | 'MiLB60';
  since: number; // league day placed
  returnLevel: Level;
}

export interface Injury {
  name: string;
  daysLeft: number;
  totalDays: number;
}

export interface BatStats {
  g: number;
  gs: number;
  pa: number;
  ab: number;
  h: number;
  d: number;
  t: number;
  hr: number;
  r: number;
  rbi: number;
  bb: number;
  k: number;
  hbp: number;
  sb: number;
  cs: number;
  sf: number;
  gidp: number;
  e: number;
}

export interface PitStats {
  g: number;
  gs: number;
  w: number;
  l: number;
  sv: number;
  hld: number;
  bs: number;
  outs: number;
  h: number;
  r: number;
  er: number;
  bb: number;
  k: number;
  hr: number;
  hbp: number;
  bf: number;
  pitches: number;
}

export interface StatEntry {
  season: number;
  level: Level;
  orgId: number;
  bat: BatStats;
  pit: PitStats;
}

export interface Player {
  id: number;
  first: string;
  last: string;
  born: number; // birth year (age = season - born)
  country: string;
  bats: Hand;
  throws: 'L' | 'R';
  pos: Pos; // primary position
  height: number; // inches
  weight: number;
  ratings: Ratings;
  pot: Potential;
  personality: Personality;
  injuryProne: number; // 0.5 (iron) .. 2 (fragile)
  scoutSeed: number;

  orgId: number | null; // null = free agent
  level: Level | null;
  on40: boolean;
  contract: Contract;
  il: IlStatus | null;
  injury: Injury | null;
  dfa: { day: number } | null;
  waivers: { day: number; fromOrg: number; type: 'outright' | 'release' } | null;
  optionsUsed: number; // option years used
  optionDaysThisSeason: number;
  optionsThisSeason: number; // times optioned this season (max 5)
  optionedOnDay: number | null; // last day optioned (min stay rule)
  mlServiceDays: number; // career ML service days
  serviceThisSeason: number;
  proSeasons: number; // seasons since first pro contract
  outrightedBefore: boolean;
  draft: { year: number; round: number; pick: number; orgId: number } | null;

  // pitcher workload
  lastPitchedDay: number;
  lastPitchCount: number;
  consecutiveDays: number;
  lastStartDay: number;

  stats: StatEntry[];
}

export type Philosophy = 'Conservative' | 'Balanced' | 'Aggressive';

export interface FarmDirector {
  id: number;
  first: string;
  last: string;
  age: number;
  development: number; // 20-80, affects player development speed
  evaluation: number; // 20-80, how well he judges readiness
  philosophy: Philosophy;
  salary: number;
  exp: number;
  orgId: number | null;
}

export interface Affiliate {
  name: string;
  abbrev: string;
}

export type Control = 'FD' | 'Manual';

export interface DepthChart {
  auto: boolean;
  lineup: { pid: number; pos: Pos }[]; // 9 batters in order, DH included
  rotation: number[];
  closer: number | null;
  setup: number[];
}

export interface Org {
  id: number;
  region: string;
  name: string;
  abbrev: string;
  league: 'AL' | 'NL';
  div: 'East' | 'Central' | 'West';
  affiliates: Record<Level, Affiliate>;
  farmDirectorId: number | null;
  control: Record<Level, Control>;
  depth: Partial<Record<Level, DepthChart>>;
  rotationIndex: Partial<Record<Level, number>>;
  cbtPayerYears: number; // consecutive prior seasons over the CBT threshold
  deadMoney: { pid: number; name: string; amount: number; season: number }[];
}

export interface GameResult {
  hs: number;
  as: number;
  innings: number;
  wp: number | null;
  lp: number | null;
  sv: number | null;
}

export interface Game {
  id: number;
  level: Level;
  day: number;
  home: number;
  away: number;
  result: GameResult | null;
  playoff?: { round: string; game: number };
}

export interface StandingRow {
  w: number;
  l: number;
  rs: number;
  ra: number;
  streak: number; // +n wins, -n losses
  last10: string; // e.g. "WLWW..."
}

export interface Transaction {
  id: number;
  season: number;
  day: number;
  orgId: number | null;
  type: string;
  text: string;
  pids: number[];
}

export interface NewsItem {
  id: number;
  season: number;
  day: number;
  orgId: number | null;
  text: string;
  pids: number[];
}

export interface BoxBatLine {
  pid: number;
  pos: string;
  ab: number;
  r: number;
  h: number;
  rbi: number;
  bb: number;
  k: number;
  hr: number;
  d: number;
  t: number;
}

export interface BoxPitLine {
  pid: number;
  outs: number;
  h: number;
  r: number;
  er: number;
  bb: number;
  k: number;
  hr: number;
  pitches: number;
  dec: string;
}

export interface BoxScore {
  gid: number;
  level: Level;
  day: number;
  home: number;
  away: number;
  lineScore: { away: number[]; home: number[] };
  hits: { away: number; home: number };
  errors: { away: number; home: number };
  bat: { away: BoxBatLine[]; home: BoxBatLine[] };
  pit: { away: BoxPitLine[]; home: BoxPitLine[] };
  notes: string[];
}

export interface PlayoffSeries {
  id: string;
  round: 'WC' | 'DS' | 'CS' | 'WS';
  league: 'AL' | 'NL' | 'MLB';
  high: number; // org id of higher seed (home advantage)
  low: number;
  wins: [number, number]; // [high, low]
  bestOf: number;
  winner: number | null;
}

export interface Playoffs {
  seeds: { AL: number[]; NL: number[] };
  series: PlayoffSeries[];
  champion: number | null;
}

export interface Settings {
  // calendar
  gamesPerSeason: Record<Level, number>;
  levelStartDay: Record<Level, number>;
  seasonDays: number;
  septemberDay: number; // day rosters expand
  // rosters
  activeMax: number;
  activeMaxSept: number;
  pitcherMax: number;
  pitcherMaxSept: number;
  fortyMax: number;
  milbActiveMax: Record<Level, number>;
  // options / waivers / service
  optionYears: number;
  optionDaysToUseYear: number;
  maxOptionsPerSeason: number;
  optionMinStayPitcher: number;
  optionMinStayPosition: number;
  serviceDaysPerYear: number;
  optionConsentServiceYears: number;
  outrightRefuseServiceYears: number;
  dfaDays: number;
  waiverDays: number;
  il10Days: number;
  il15Days: number;
  il60Days: number;
  // money
  minSalary: number;
  minorSalaryFirstML: number;
  minorSalarySecondML: number;
  cbtThreshold: number;
  cbtTierStep: number;
  cbtBaseRates: number[]; // by consecutive payer years: 1st, 2nd, 3rd+
  cbtSurcharges: number[]; // tier 2, tier 3, tier 4
  playerBenefits: number;
  // gameplay
  scoutingAccuracy: 'Low' | 'Normal' | 'High' | 'Perfect';
  ratingIncrement: 1 | 5;
  injuryRate: number;
  autoMlbMoves: boolean;
  extraInningRunner: boolean;
}

export interface League {
  version: number;
  id: string;
  name: string;
  created: number;
  startYear: number;
  season: number;
  phase: 'regular' | 'playoffs' | 'offseason';
  day: number;
  userOrgId: number;
  settings: Settings;
  orgs: Org[];
  players: Record<number, Player>;
  farmDirectors: FarmDirector[];
  schedule: Game[];
  standings: Record<Level, Record<number, StandingRow>>;
  transactions: Transaction[];
  news: NewsItem[];
  boxScores: Record<number, BoxScore>;
  playoffs: Playoffs | null;
  champions: { season: number; level: Level; orgId: number }[];
  nextId: { player: number; game: number; tx: number; news: number; staff: number };
  lastFdRun: number;
  waiverClaims: Record<number, number[]>;
  lastDevDay: number;
}
