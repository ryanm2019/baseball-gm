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
  type: 'club' | 'player' | 'mutual' | 'vesting';
  season: number; // the option year
  salary: number;
  buyout: number;
  vest?: { stat: 'pa' | 'ip' | 'g'; need: number }; // vesting: guaranteed if he reaches this in the final season
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
  start?: number; // first season of a scheduled (year-by-year) deal
  sched?: number[]; // salary by season from `start`
  aav?: number; // CBT average annual value (deferred money at present value)
  optOuts?: number[]; // seasons after which the player may opt out
  ntc?: 'full' | number[]; // no-trade clause: full, or org ids he can block
  deferPct?: number; // share of each year's salary deferred
}

export interface FaOffer {
  orgId: number;
  years: number;
  aav: number;
  day: number;
  terms?: import('./terms.ts').Terms; // full structure (schedule and clauses); years/aav summarize it
}

export interface FaStatus {
  opened: number; // league day the player hit the market
  decideDay: number;
  asking: { years: number; aav: number };
  offers: FaOffer[];
  formerOrg: number | null;
  qo: boolean; // declined a qualifying offer (signing team forfeits a pick)
  posted?: { from: string; deadline: number }; // posted by his Asian club: sign by the deadline or he goes back
  scooped?: number; // how far the insider feed has followed him (1 = meetings reported, 2 = finalists)
  passed?: number[]; // clubs that pulled their offer and moved on
  milbOffers?: { orgId: number; level: Level; invite: boolean; day: number }[]; // minor league bids (bidding window)
  milbDecide?: number; // day he picks among minor league offers
  pending?: { orgId: number; day: number; offer: FaOffer }; // agreed with you; waits for a 40-man/active spot
  talk?: { respondDay: number; range?: { lo: number; hi: number; years: number }; noted?: number }; // his agent's reply to your latest offer is due; the range he gave you; last rival alert day
  extended?: boolean; // pushed his date back once for a bidding war
}

export interface IfaInfo {
  year: number;
  asking: number; // what he really wants (moves on negotiation day and after signing day)
  verbal?: { orgId: number; amount: number; day: number } | null; // agreed, not yet signed (breakable)
  bids?: Record<number, number>; // clubs in on him -> their latest offer
  lastOffer?: Record<number, number>; // org -> league day of its last offer
  lostNotified?: boolean; // you've been told he went elsewhere
  stiff?: number; // lowballs make him dig in
  posted?: string; // a young pro posted from NPB/KBO/CPBL, signed with pool money
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
  cls?: 'HS' | 'JR' | 'SR'; // high school, draft-eligible junior, senior
  commit?: number; // high schoolers: strength of college commitment, 0..1
  slot?: number;
  asking?: number; // hidden demand once drafted
  stiff?: number; // grows when lowballed
  lastOffer?: number; // league day of the last official offer
  lastAmount?: number;
  orgId?: number; // drafted by, unsigned
  round?: number;
  pick?: number;
}

export interface IlStatus {
  type: 'IL10' | 'IL15' | 'IL60' | 'MiLB7' | 'MiLB60';
  since: number; // league day placed
  returnLevel: Level;
  readyNoticeDay?: number; // when we last told the user he's ready to come off
}

export interface Injury {
  name: string;
  daysLeft: number;
  totalDays: number;
  decision?: { estRisk: number; recommend: 'surgery' | 'rehab'; surgeryDays: number; label: string; decided: boolean }; // serious injuries
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
  // MLB splits: vsL, vsR, risp, home, away, m3..m10 (month)
  splits?: { bat?: Record<string, BatStats>; pit?: Record<string, PitStats> };
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
  dfa: { day: number; offered?: boolean } | null;
  waivers: { day: number; fromOrg: number; type: 'outright' | 'release'; flagged?: boolean } | null;
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
  devVol?: number; // how widely his development swings (drafted high schoolers > college players)
  ifa?: IfaInfo; // international amateur, unsigned
  fa?: FaStatus | null;
  ext?: { lastOffer?: number; stiff?: number; season?: number } | null; // extension talks this season
  agent?: number; // Agent id
  morale?: Morale;
  posInfo?: { home: Pos; exp: Partial<Record<FieldPos, number>> }; // position experience (home = where he learned the game)
  stretch?: { limit: number } | null;
  straight?: number; // consecutive games started in the field
  straightDay?: number; // pitch limit while a converted reliever is stretched out as a starter
  rehab?: { level: Level; daysLeft: number; total: number } | null;
  reinjury?: { risk: number; name: string; surgeryDays: number; until: number }; // chose rehab over surgery // rehab assignment before coming off the IL
  storyFx?: { text: string; until: number; add: Record<string, number> }[]; // temporary rating changes from storylines
  arb?: ArbCase | null;
  rule5?: { fromOrg: number; season: number } | null;
  qoReceived?: boolean;
  qoPending?: number;
  successor?: { season: number; level: Level; invite: boolean; day: number; byAgm?: boolean; answer?: 'yes' | 'no' } | null; // successor contract offer before minor league free agency
  faSignedRebuild?: boolean; // signed by a club that was rebuilding (a flip candidate)
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
  recentApps?: number[]; // league days of recent relief appearances (workload)
  form?: { season: number; day: number; n: number; v: number; f?: number }; // recent stretch, fading (hot/cold)

  stats: StatEntry[];
}

export type Philosophy = 'Conservative' | 'Balanced' | 'Aggressive';

export type StaffRole = 'AGM' | 'MGR' | 'PC' | 'HC' | 'FD' | 'SD' | 'PRO' | 'AMA' | 'INT';

// A scout's written report on one player (your organization only).
export interface ScoutReport {
  pid: number;
  season: number;
  day: number;
  by: StaffRole; // which scout filed it
  visits: number; // looks so far (a second look sharpens it further)
  ovr: number; // the read when filed
  pot: number;
  role: string; // projection, e.g. "Above-average regular", "No. 3 starter"
  risk: 'Low' | 'Medium' | 'High' | 'Extreme';
  tools: { label: string; v: number }[];
  text: string;
  why: string; // why he was scouted
}
export type ScoutMode = 'auto' | 'buying' | 'selling' | 'balanced';
export interface ScoutingState {
  reports: Record<number, ScoutReport>;
  mode: ScoutMode; // the director's plan: auto follows your club's situation
  month: string; // 'season-month' the current plan covers
  plan: { pid: number; by: StaffRole; due: number; why: string }[]; // visits still to make this month
  rush: { pid: number; due: number }[];
  requests: number[]; // players you asked about (first in line next)
  fresh: number[]; // reports filed since the last digest
  lastDigest: number;
}
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
export type Dept = 'scouting' | 'development' | 'medical' | 'facilities';
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

export type MoveType = 'Trade' | 'Free agent' | 'Waiver claim' | 'Draft' | 'International' | 'Rule 5' | 'Extension';
export const MOVE_TYPES: MoveType[] = ['Trade', 'Free agent', 'Waiver claim', 'Draft', 'International', 'Rule 5', 'Extension'];
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

// A trade offer you sent: the other club answers in a day or two (same day at the deadline).
export interface TradeTalk {
  id: number;
  orgId: number; // the other club
  season: number;
  sentDay: number;
  respondDay: number;
  round: number; // 1 = your first offer
  proposal: TradeProposal; // orgs = [you, them]
  status: 'waiting' | 'countered' | 'done' | 'declined' | 'withdrawn' | 'expired';
  counter?: TradeProposal; // their counter (orgs = [you, them])
  counterExpires?: number;
  noise: number; // their read on the day (fraction of value), fixed per offer
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
  | 'waivers'
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
  { key: 'waivers', label: 'Flag waiver players who fill a team need (you make the claim)', def: true },
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
  lineup: { pid: number; pos: Pos }[]; // 9 batters in order, DH included (vs right-handed starters)
  lineupL?: { pid: number; pos: Pos }[]; // vs left-handed starters (falls back to lineup)
  rotation: number[];
  closer: number | null;
  setup: number[];
  pen?: Record<number, PenRole>; // role for every reliever
  playoffRotation?: 3 | 4; // starters used in the playoffs (the rest go to the bullpen)
  bullpenDays?: number[]; // rotation slots (0-based) that are bullpen games
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
  deferred?: { pid: number; name: string; amount: number; season: number }[];
  fin?: import('./finances.ts').Fin; // attendance, revenue, hype
  lastGameDay?: Partial<Record<Level, number>>;
  scoutFocus?: Partial<Record<StaffRole, string>>; // 'general' | 'HS' | 'College' | 'country:<name>' | 'org:<id>' // last day each affiliate played (for fatigue streaks) // deferred salary owed in later seasons
  stance: TradeStance;
  winterStrategy?: Strategy; // strategy coming out of the offseason (midseason changes don't touch it)
  stanceStrategy?: Strategy; // strategy the stance was set under (kept until it changes)
  block: number[]; // players the club is shopping
  interest: TradeInterest; // user only: watched players and wanted positions
  goals?: OwnerGoals; // user only
  depts: Record<Dept, number>; // annual department budgets
  opBudget: number; // owner's operating budget for departments
  facilities: number; // -1 (poor) .. +1 (excellent), moves slowly with spending
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

// Insider feed: free agent meetings, finalists, agreements, trades, teams shopping players.
export interface Scoop {
  id: number;
  season: number;
  day: number;
  text: string;
  pids: number[];
}

// Agents represent players; reputation shapes negotiations.
export interface Agent {
  id: number;
  first: string;
  last: string;
  firm: string;
  reputation: number; // 1-100
  style: 'Hard-liner' | 'Market-driven' | 'Team-friendly' | 'Loyalist';
  discount: number; // multiplies how much security discount his clients take (<1 = harder)
  inSeasonBan: number; // pushes clients toward refusing in-season talks
  toMarket: number; // pushes clients toward testing free agency
}

export interface MoraleEvent { season: number; day: number; delta: number; text: string }

export interface Morale {
  value: number; // 0-100, 50 = content
  parts?: { role: number; team: number; pay: number; treatment: number; performance: number; clubhouse: number };
  events: MoraleEvent[];
}

export interface InboxAction { key: string; label: string }

export interface InboxMsg {
  id: number;
  season: number;
  day: number;
  from: string; // "Agent Jane Doe (Apex Sports)", "Owner", "Assistant GM", ...
  subject: string;
  text: string;
  pids: number[];
  kind: 'role' | 'trade-request' | 'callup' | 'extension' | 'info' | 'story' | 'position' | 'september' | 'injury' | 'il-ready' | 'trade-reply' | 'staff' | 'dfa-offer' | 'fa-reply';
  faPid?: number; // fa-reply: the free agent
  dfaDeal?: { orgId: number; pid: number; cash: number; prospect: number | null }; // dfa-offer: what they'd give for him
  talkId?: number; // trade-reply: the negotiation it belongs to
  actions?: InboxAction[];
  resolved?: string; // what you chose
  read?: boolean;
  stop?: boolean; // pauses the sim until you've seen it
  stopped?: boolean;
  link?: { page: string; args?: (string | number)[]; query?: Record<string, string | number> };
  storyId?: string;
}

// A promise you made a player; checked on `due`.
export interface Promise_ {
  pid: number;
  kind: 'playing-time' | 'callup' | 'trade';
  made: number; // day
  due: number;
  season: number;
}

export type AwardName = 'MVP' | 'Cy Young' | 'Rookie of the Year' | 'Reliever of the Year' | 'Gold Glove' | 'Silver Slugger' | 'All-Star';

export interface AwardRec {
  season: number;
  award: AwardName;
  lg: 'AL' | 'NL';
  pid: number;
  orgId: number;
  pos?: string;
  line: string; // stat line at the time
}

// One voted award in one league: every player who got a vote, in order.
export interface AwardVote {
  season: number;
  award: AwardName;
  lg: 'AL' | 'NL';
  voters: number;
  scale: number[]; // points for 1st, 2nd, ...
  rows: { pid: number; orgId: number; pos: string; line: string; war: number; points: number; votes: number[] }[]; // votes[i] = ballots with him in place i+1
}

export interface HofRec { season: number; pid: number; pct: number; war: number; line: string; ballot: number }

export interface SeasonRec { season: number; orgId: number; w: number; l: number; result: string }

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
  rosters?: Record<string, number[]>; // `${round}:${orgId}` -> the 26 for that round
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
  salaryScale?: number; // league-wide salary inflation since the league began (1 = start)
  cbaScale?: number; // salaryScale when the current CBA set the tax threshold
  storylines?: 'off' | 'rare' | 'normal' | 'frequent';
  careerEndingStories?: boolean;
}

export interface DraftAdjust {
  comp: { orgId: number; after: 'R1' | 'CBB' | 'R4' }[];
  forfeit: { orgId: number; round: number }[];
  unsigned?: { orgId: number; round: number; pos: number }[]; // comp picks for unsigned 1st/2nd rounders
}

export interface DraftPick {
  round: number;
  pick: number; // overall
  orgId: number;
  slot: number;
  label?: string; // e.g. 'CB-A', 'Comp'
  pid: number | null;
  signed: boolean | null;
  bonus?: number; // what he signed for (kept here: the player can leave the game later)
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
  intl: { pools: Record<number, number>; spent: Record<number, number>; open: boolean; acquired?: Record<number, number>; base?: Record<number, number>; year?: number };
  cbtHistory: CbtRecord[];
  wsEndDay: number | null;
  windowNote?: number; // season the exclusive-window notice went out
  lastStandings?: number[]; // org ids, worst record first
  lastPlayoffTeams?: number[];
  draftAdjust?: DraftAdjust;
  scouting?: ScoutingState; // your scouting department's plan and reports
  farmRankings?: import('./farmRank.ts').FarmEdition[]; // published farm system rankings (latest last)
  draftLottery?: { season: number; round1: number[]; lottery: { orgId: number; pick: number; from: number }[] }; // December's lottery for next summer's draft
  cbPicks: CbPick[];
  tradeOffers: TradeOffer[];
  tradeTalks?: TradeTalk[];
  tradeFloated?: { sig: string; day: number }[]; // packages a club put on the table (Trade Finder)
  // Per club: how many rounds this season and when they'll take your calls again.
  tradeRelations?: Record<number, { season: number; rounds: number; frozenUntil: number }>;
  ifaPenalty: Record<number, number>; // pool reductions for the next signing period
  fired?: boolean;
  moves: Move[];
  farmReports?: FarmReport[];
  farmSnap?: { season: number; totals: Record<number, number[]> };
  devSnap?: { season: number; ratings: Record<number, number[]> };
  lastWins?: Record<number, number>; // last season's MLB wins by org
  scoops?: Scoop[];
  devAdj?: number; // development speed for players 27 and under, tuned to keep the number of stars steady
  offenseAdj?: number;
  awards?: AwardRec[];
  awardVotes?: AwardVote[]; // ballot results for the voted awards
  hof?: HofRec[];
  hofBallot?: Record<number, number>; // pid -> years on the ballot
  seasonRecs?: SeasonRec[]; // hitter rating points added league-wide to hold the run environment steady
  agents?: Agent[];
  inbox?: InboxMsg[];
  stories?: { id: number; season: number; day: number; title: string; text: string; pids: number[]; orgId: number | null }[];
  promises?: Promise_[];
  futureForfeits?: { season: number; orgId: number; round: number }[]; // draft-pool penalties two years out
  draftTax?: { season: number; orgId: number; over: number; tax: number; penalty: string }[];
  preview?: SeasonPreview;
  ovrBaseline?: { season: number; ovr: Record<number, number> }; // true overall at the start of the season
}

export interface FarmReport {
  season: number;
  day: number;
  by: string;
  sections: { title: string; lines: { text: string; pids: number[] }[] }[];
}

export interface SeasonPreview {
  season: number;
  risers: { pid: number; from: number; to: number }[];
  decliners: { pid: number; from: number; to: number }[];
  draft: { pick: number; orgId: number; pid: number; label?: string }[];
  draftSeason: number;
}
