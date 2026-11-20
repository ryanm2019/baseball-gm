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

export interface ContractOption {
  type: 'club' | 'player';
  season: number; // the option year
  salary: number;
  buyout: number;
}

export interface Contract {
  type: ContractType;
  salary: number; // annual MLB salary (dollars). For MiLB deals this is the minor league salary.
  minorSalary: number; // salary while in the minors (split ML contracts)
  exp: number; // last season of the contract
  oneWay: boolean; // one-way ML contracts pay the MLB salary even in the minors
  signed: number; // season signed
  option?: ContractOption;
  bonus?: number; // signing bonus (draft / international)
}

export interface FaOffer {
  orgId: number;
  years: number;
  aav: number;
  day: number;
}

export interface FaStatus {
  opened: number; // league day the player hit the market
  decideDay: number;
  asking: { years: number; aav: number };
  offers: FaOffer[];
  formerOrg: number | null;
  qo: boolean; // declined a qualifying offer (signing team forfeits a pick)
}

export interface ArbCase {
  projected: number;
  player: number | null; // filed figures
  team: number | null;
  settled: number | null;
  result: string | null;
}

export interface DraftInfo {
  year: number;
  college: boolean;
  slot?: number;
  asking?: number;
  orgId?: number; // drafted by, unsigned
  round?: number;
  pick?: number;
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
  prospect?: DraftInfo; // in the upcoming/active amateur draft class
  ifa?: { year: number; asking: number }; // international amateur, unsigned
  fa?: FaStatus | null;
  arb?: ArbCase | null;
  rule5?: { fromOrg: number; season: number } | null;
  qoReceived?: boolean;
  qoPending?: number;
  faSigned?: number; // first season of a free-agent contract (can't be traded until June 15)
  teamSince?: number; // season he joined his current organization (10-and-5 rights)
  joined?: { season: number; day: number }; // when he joined (postseason eligibility, trade restrictions)
  signAge?: number;
  retired?: number;
  earned?: Record<string, number>; // salary paid, keyed "season:orgId"

  // pitcher workload
  lastPitchedDay: number;
  lastPitchCount: number;
  consecutiveDays: number;
  lastStartDay: number;

  stats: StatEntry[];
}

export type Philosophy = 'Conservative' | 'Balanced' | 'Aggressive';

export type StaffRole = 'AGM' | 'MGR' | 'PC' | 'HC' | 'FD' | 'SD' | 'PRO' | 'AMA' | 'INT';
export const STAFF_ROLES: StaffRole[] = ['AGM', 'MGR', 'PC', 'HC', 'FD', 'SD', 'PRO', 'AMA', 'INT'];
export const STAFF_NAMES: Record<StaffRole, string> = {
  AGM: 'Assistant GM',
  MGR: 'Manager',
  PC: 'Pitching Coach',
  HC: 'Hitting Coach',
  FD: 'Farm Director',
  SD: 'Scouting Director',
  PRO: 'Pro Scout',
  AMA: 'Amateur Scout',
  INT: 'International Scout',
};
export const SCOUT_ROLES: StaffRole[] = ['SD', 'PRO', 'AMA', 'INT'];

export type ManagerStyle = 'Old school' | 'Balanced' | 'Analytical';

// One shape for every staff role; each role uses a subset of the ratings.
//  AGM: evaluation, negotiation
//  MGR: tactics, style (in-game decisions)
//  PC/HC: development, health (PC only)
//  FD: development, evaluation, philosophy
//  SD/PRO/AMA/INT: evaluation (scouting accuracy)
export interface Staff {
  id: number;
  role: StaffRole;
  first: string;
  last: string;
  age: number;
  development: number;
  evaluation: number;
  negotiation: number;
  tactics: number;
  health: number;
  philosophy: Philosophy;
  style: ManagerStyle;
  salary: number;
  exp: number;
  orgId: number | null;
}

export type FarmDirector = Staff;

export type OwnerType = 'Cheap' | 'Moderate' | 'Big spender' | 'Win-now';
export type Strategy = 'Contend' | 'Retool' | 'Rebuild';

export interface Owner {
  first: string;
  last: string;
  type: OwnerType;
  since: number;
  patience: number; // 0-100; the user is fired at 0
}

export type GoalType = 'wins' | 'playoffs' | 'series' | 'budget' | 'cbt';
export interface OwnerGoal {
  type: GoalType;
  target: number; // wins, budget dollars or CBT dollars; unused for playoffs/series
  text: string;
  met?: boolean | null; // set at season end
}
export interface OwnerGoals {
  season: number;
  items: OwnerGoal[];
  checkins: number[]; // league days a check-in was sent
}

export type TradeStance = 'Buying' | 'Selling' | 'Standing pat' | 'Listening';
export const TRADE_STANCES: TradeStance[] = ['Buying', 'Selling', 'Listening', 'Standing pat'];
export type NeedPos = Pos;

export interface TradeInterest {
  pids: number[]; // other teams' players the user is watching
  pos: NeedPos[]; // positions the user wants
}

export type MoveType = 'Trade' | 'Free agent' | 'Waiver claim' | 'Draft' | 'International' | 'Rule 5';
export const MOVE_TYPES: MoveType[] = ['Trade', 'Free agent', 'Waiver claim', 'Draft', 'International', 'Rule 5'];
export interface MoveSide {
  orgId: number;
  gets: number[]; // players this club acquired
  cash: number; // cash received
  pool: number; // international pool money received
  picks: string[]; // descriptions of draft picks received
}
export interface Move {
  id: number;
  season: number;
  day: number;
  start: number; // first season the acquired players' stats count toward the move
  type: MoveType;
  sides: MoveSide[];
  text: string;
  cost: number; // guaranteed money (signings) or bonus (amateurs)
}

export interface TradeAssets {
  pids: number[];
  cash: number; // dollars of this season's salary paid to the other team
  pool: number; // international bonus pool dollars
  cbPicks: string[]; // competitive balance pick ids
}

export interface TradeProposal {
  orgs: [number, number];
  give: [TradeAssets, TradeAssets]; // give[i] = what orgs[i] sends
}

export interface TradeOffer {
  id: number;
  day: number;
  season: number;
  fromOrg: number;
  proposal: TradeProposal; // orgs[0] = AI team, orgs[1] = user
  expires: number;
  note?: string;
}

export interface CbPick {
  id: string;
  season: number;
  round: 'A' | 'B';
  originalOrg: number;
  orgId: number;
}

export type AgmDuty =
  | 'injuries'
  | 'roster'
  | 'depth'
  | 'options'
  | 'tender'
  | 'arbitration'
  | 'rule5protect'
  | 'rule5draft'
  | 'milbfa'
  | 'draft'
  | 'ifa'
  | 'trades';

export const AGM_DUTIES: { key: AgmDuty; label: string; def: boolean }[] = [
  { key: 'injuries', label: 'Injuries: IL placements, activations and injury call-ups', def: true },
  { key: 'roster', label: 'MLB roster: call-ups, send-downs and roster limits', def: false },
  { key: 'depth', label: 'MLB lineups, rotation and bullpen roles', def: true },
  { key: 'options', label: 'Contract options and qualifying offers', def: false },
  { key: 'tender', label: 'Tender / non-tender decisions', def: false },
  { key: 'arbitration', label: 'Arbitration figures and settlements', def: false },
  { key: 'rule5protect', label: 'Rule 5 protection (40-man adds)', def: false },
  { key: 'rule5draft', label: 'Rule 5 draft picks', def: false },
  { key: 'milbfa', label: 'Minor league free agent signings', def: true },
  { key: 'draft', label: 'Amateur draft picks and signings', def: false },
  { key: 'ifa', label: 'International amateur signings', def: false },
  { key: 'trades', label: 'Answer trade offers from other teams', def: false },
];

export interface Affiliate {
  name: string;
  abbrev: string;
}

export type Control = 'FD' | 'Manual';

export type PenRole = 'CL' | 'SU' | 'MR' | 'LR' | 'MU';
export const PEN_ROLES: { key: PenRole; label: string; help: string }[] = [
  { key: 'CL', label: 'Closer', help: 'Ninth inning (or later) with a lead of 1-3, or a tie at home' },
  { key: 'SU', label: 'Setup', help: 'Seventh and eighth innings of close games (two setup men)' },
  { key: 'MR', label: 'Middle relief', help: 'Sixth and seventh innings, close or trailing' },
  { key: 'LR', label: 'Long relief', help: 'When the starter leaves early, and extra innings' },
  { key: 'MU', label: 'Mop-up', help: 'Blowouts, either way' },
];

export interface DepthChart {
  auto: boolean;
  lineup: { pid: number; pos: Pos }[]; // 9 batters in order, DH included
  rotation: number[];
  closer: number | null;
  setup: number[];
  pen?: Record<number, PenRole>; // role for every reliever
}

export interface Org {
  id: number;
  region: string;
  name: string;
  abbrev: string;
  league: 'AL' | 'NL';
  div: 'East' | 'Central' | 'West';
  affiliates: Record<Level, Affiliate>;
  market: number;
  staff: Partial<Record<StaffRole, number>>;
  agm: Record<AgmDuty, boolean>;
  tenderPlan: Record<number, boolean>; // pid -> tender?
  optionPlan: Record<number, boolean>; // pid -> exercise club option
  qoPlan: Record<number, boolean>; // pid -> extend a qualifying offer
  rule5Targets: number[];
  owner: Owner;
  strategy: Strategy;
  budget: number; // owner's payroll budget for the coming season
  cash: { season: number; amount: number; note: string }[]; // cash sent (+) or received (-) in trades
  control: Record<Level, Control>;
  depth: Partial<Record<Level, DepthChart>>;
  rotationIndex: Partial<Record<Level, number>>;
  cbtPayerYears: number; // consecutive prior seasons over the CBT threshold
  deadMoney: { pid: number; name: string; amount: number; season: number }[];
  stance: TradeStance;
  block: number[]; // players the club is shopping
  interest: TradeInterest; // user only: watched players and wanted positions
  goals?: OwnerGoals; // user only
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
  draftDay: number; // regular-season day of the amateur draft (All-Star break)
  draftSigningDays: number;
  draftRounds: number;
  tradeDeadlineDay: number;
  postseasonEligibilityDay: number;
  tradeDifficulty: 'Easy' | 'Normal' | 'Hard' | 'Insane';
  aiTradeFactor: number;
  extraInningRunner: boolean;
  allowFiring: boolean;
}

export interface DraftAdjust {
  comp: { orgId: number; after: 'R1' | 'CBB' | 'R4' }[];
  forfeit: { orgId: number; round: number }[];
}

export interface DraftPick {
  round: number;
  pick: number; // overall
  orgId: number;
  slot: number;
  label?: string; // e.g. 'CB-A', 'Comp'
  pid: number | null;
  signed: boolean | null;
}

export interface DraftState {
  season: number;
  picks: DraftPick[];
  index: number; // next pick to make
  done: boolean;
  deadline: number; // league day signing deadline
  pools: Record<number, number>;
  lottery: { orgId: number; pick: number; from: number }[];
}

export interface CbtRecord {
  season: number;
  orgId: number;
  cbt: number;
  tax: number;
}

export interface League {
  version: number;
  id: string;
  name: string;
  created: number;
  startYear: number;
  season: number;
  phase: 'preseason' | 'regular' | 'playoffs' | 'offseason';
  day: number;
  userOrgId: number;
  settings: Settings;
  orgs: Org[];
  players: Record<number, Player>;
  staff: Staff[];
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
  events: string[]; // offseason / calendar events already processed or prompted this cycle
  draft: DraftState | null;
  intl: { pools: Record<number, number>; spent: Record<number, number>; open: boolean; acquired?: Record<number, number>; base?: Record<number, number> };
  cbtHistory: CbtRecord[];
  wsEndDay: number | null;
  lastStandings?: number[]; // org ids, worst record first
  lastPlayoffTeams?: number[];
  draftAdjust?: DraftAdjust;
  cbPicks: CbPick[];
  tradeOffers: TradeOffer[];
  ifaPenalty: Record<number, number>; // pool reductions for the next signing period
  fired?: boolean;
  moves: Move[];
  farmReports?: FarmReport[];
  farmSnap?: { season: number; totals: Record<number, number[]> };
  devSnap?: { season: number; ratings: Record<number, number[]> };
}

export interface FarmReport {
  season: number;
  day: number;
  by: string;
  sections: { title: string; lines: { text: string; pids: number[] }[] }[];
}
