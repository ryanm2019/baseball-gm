// Plate-appearance level game simulation.
//
// Each plate appearance is resolved with the odds-ratio (log5) method: the
// batter's rate for an event, the pitcher's rate, and the league rate combine
// into a matchup probability. Ratings move a player's rate up or down from the
// league average. Pitch counts are simulated per PA to drive fatigue, pitcher
// hooks and bullpen workload.
import type { BatStats, BoxBatLine, BoxPitLine, BoxScore, FieldPos, Level, PenRole, PitStats, Player, Pos } from '../types.ts';
import { moraleBoost } from '../morale.ts';
import { clamp, normal, rand } from '../random.ts';
import { posRating } from '../ratings.ts';
import { emptyBat, emptyPit } from '../util.ts';
import type { GameLineup } from './lineup.ts';

// League environment (per PA), roughly modern MLB.
const L_K = 0.222;
const L_BB = 0.077;
const L_HBP = 0.011;
const L_HR_BIP = 0.04;
const L_BABIP = 0.291;
const L_2B_SHARE = 0.228;
const L_3B_SHARE = 0.021;

const PITCH_LIMIT_CAP: Record<Level, number> = { MLB: 112, AAA: 100, AA: 95, 'A+': 90, A: 85, CPX: 70, DSL: 65 };

// Run environment by level: lower levels walk more, make more errors and run more.
const ENV: Record<Level, { bb: number; hr: number; babip: number; err: number; sb: number }> = {
  MLB: { bb: 1, hr: 1, babip: 1, err: 1, sb: 1 },
  AAA: { bb: 1.14, hr: 1.08, babip: 1.06, err: 1.3, sb: 1.4 },
  AA: { bb: 1.15, hr: 0.98, babip: 1.06, err: 1.5, sb: 1.6 },
  'A+': { bb: 1.2, hr: 0.92, babip: 1.07, err: 1.8, sb: 1.9 },
  A: { bb: 1.28, hr: 0.88, babip: 1.08, err: 2.0, sb: 2.1 },
  CPX: { bb: 1.33, hr: 0.82, babip: 1.09, err: 2.4, sb: 2.2 },
  DSL: { bb: 1.38, hr: 0.75, babip: 1.1, err: 2.6, sb: 2.3 },
};

const log5 = (b: number, p: number, l: number): number => {
  const x = (b * p) / l;
  const y = ((1 - b) * (1 - p)) / (1 - l);
  return x / (x + y);
};

const sc = (r: number, coef: number) => Math.exp((coef * (r - 50)) / 10);

// Diminishing returns at the top of the scale: elite ratings still help, but a
// single star can't carry a lineup or staff to absurd lines (think Trout).
// League offense correction (rating points for hitters), set each day from
// league.offenseAdj so the run environment doesn't drift as players develop.
let OFFENSE_ADJ = 0;
export function setOffenseAdj(x: number): void { OFFENSE_ADJ = x; }

const SOFT_AT = 57;
const soft = (r: number): number => (r <= SOFT_AT ? r : SOFT_AT + (r - SOFT_AT) * 0.4);

const oddsAdj = (p: number, mult: number): number => {
  const o = (p / (1 - p)) * mult;
  return o / (1 + o);
};

interface Runner {
  p: Player;
  resp: PitcherApp; // pitcher charged if this runner scores
  earned: boolean;
}

interface PitcherApp {
  p: Player;
  line: PitStats;
  box: BoxPitLine;
  isStarter: boolean;
  limit: number;
  faced: Map<number, number>;
  runsThisOuting: number;
  entryLead: number;
  saveSit: boolean;
  blown: boolean;
  enteredInning: number;
  outsAtEntry: number;
  boost: number; // plate appearances of settling down after a mound visit
  visitedInning: number | null;
  coldPen: number; // brought in before he was warm
  coldPAs: number;
}

interface Side {
  lu: GameLineup;
  order: { p: Player; pos: Pos }[];
  next: number;
  pitcher: PitcherApp;
  apps: PitcherApp[];
  used: Set<number>;
  runs: number;
  hits: number;
  errors: number;
  lineScore: number[];
  defense: number;
  errRating: number;
  ofArm: number;
  catcher: Player | null;
  tdp: number;
  bat: Map<number, { line: BatStats; box: BoxBatLine }>;
}

export interface InjuryEvent {
  p: Player;
  days: number;
  name: string;
}

export interface GameOutput {
  homeRuns: number;
  awayRuns: number;
  innings: number;
  batLines: { p: Player; orgId: number; line: BatStats }[];
  pitLines: { p: Player; orgId: number; line: PitStats; isStarter: boolean }[];
  injuries: InjuryEvent[];
  box: BoxScore;
  wp: number | null;
  lp: number | null;
  sv: number | null;
  warmed: { p: Player; pitches: number }[]; // warmed up but didn't pitch
}

const INJURIES_SHORT = ['hamstring strain', 'sprained ankle', 'back spasms', 'oblique strain', 'bruised hand', 'groin strain', 'neck stiffness', 'hip flexor strain', 'wrist inflammation', 'concussion'];
const INJURIES_ARM_SHORT = ['shoulder fatigue', 'elbow inflammation', 'forearm tightness', 'blister', 'lat strain', 'rotator cuff tendinitis'];
const INJURIES_LONG = ['torn hamstring', 'broken hand', 'knee sprain', 'fractured foot', 'torn labrum', 'ACL tear'];
const INJURIES_ARM_LONG = ['UCL sprain', 'flexor tendon strain', 'shoulder impingement', 'lat strain (high grade)'];

function rollInjury(pitcher: boolean): { days: number; name: string } {
  const r = rand();
  let days: number;
  if (r < 0.5) days = 3 + Math.floor(rand() * 12);
  else if (r < 0.8) days = 15 + Math.floor(rand() * 25);
  else if (r < 0.95) days = 40 + Math.floor(rand() * 60);
  else days = pitcher ? 330 + Math.floor(rand() * 120) : 120 + Math.floor(rand() * 120);
  let name: string;
  if (pitcher) {
    const pool = days > 40 ? INJURIES_ARM_LONG : INJURIES_ARM_SHORT;
    name = days > 300 ? 'torn UCL (Tommy John surgery)' : pool[Math.floor(rand() * pool.length)];
  } else {
    const pool = days > 40 ? INJURIES_LONG : INJURIES_SHORT;
    name = pool[Math.floor(rand() * pool.length)];
  }
  return { days, name };
}

const DEF_WEIGHT: Record<FieldPos, number> = { C: 0.1, '1B': 0.08, '2B': 0.14, '3B': 0.12, SS: 0.18, LF: 0.1, CF: 0.16, RF: 0.12 };

function teamDefense(order: { p: Player; pos: Pos }[]): { def: number; err: number; ofArm: number; catcher: Player | null; tdp: number } {
  let def = 0;
  let w = 0;
  let err = 0;
  let ofArm = 0;
  let nOf = 0;
  let catcher: Player | null = null;
  let tdp = 0;
  let nMi = 0;
  for (const { p, pos } of order) {
    if (pos === 'DH' || pos === 'SP' || pos === 'RP') continue;
    const fp = pos as FieldPos;
    def += DEF_WEIGHT[fp] * posRating(p.ratings.def, fp);
    w += DEF_WEIGHT[fp];
    const d = p.ratings.def;
    err += fp === 'LF' || fp === 'CF' || fp === 'RF' ? d.ofErr : fp === 'C' ? d.cAbil : d.ifErr;
    if (fp === 'LF' || fp === 'CF' || fp === 'RF') {
      ofArm += d.ofArm;
      nOf++;
    }
    if (fp === 'C') catcher = p;
    if (fp === '2B' || fp === 'SS') {
      tdp += d.tdp;
      nMi++;
    }
  }
  return {
    def: w ? def / w : 40,
    err: err / 8,
    ofArm: nOf ? ofArm / nOf : 45,
    catcher,
    tdp: nMi ? tdp / nMi : 45,
  };
}

function pitchLimit(p: Player, starter: boolean, level: Level): number {
  const st = p.ratings.pit.stamina;
  if (starter) return Math.min(PITCH_LIMIT_CAP[level], 60 + (st - 20) * 0.75);
  return Math.max(15, 14 + (st - 20) * 1.0);
}

export interface GameOpts {
  gid: number;
  day: number;
  injuryRate: number;
  ghostRunner: boolean;
  live?: boolean; // keep play-by-play
}

// Manager's calls for the next plate appearance.
export interface Tactic {
  steal?: boolean;
  bunt?: boolean;
  hitRun?: boolean;
  infieldIn?: boolean;
}

export interface PlayEvent {
  inning: number;
  half: number;
  outs: number;
  away: number;
  home: number;
  text: string;
  scoring: boolean;
}

export interface LiveSide {
  orgId: number;
  runs: number;
  hits: number;
  errors: number;
  lineScore: number[];
  order: { p: Player; pos: Pos; line: BatStats }[];
  next: number;
  pitcher: { p: Player; line: PitStats; isStarter: boolean; cold: boolean };
  apps: { p: Player; line: PitStats }[];
  bench: Player[];
  bullpen: { p: Player; role: PenRole | null; status: string; warm: number; ready: boolean }[];
  visitsLeft: number;
  autoPitching: boolean;
  needPitcher: boolean;
  infieldIn: boolean;
}

export interface LiveState {
  inning: number;
  half: number; // 0 = top (away bats), 1 = bottom
  outs: number;
  bases: (Player | null)[];
  over: boolean;
  sides: [LiveSide, LiveSide]; // [away, home]
  batter: Player;
  pitcher: Player;
  log: PlayEvent[];
}

export interface GameEngine {
  step(): void;
  done(): boolean;
  finish(): GameOutput;
  state(): LiveState;
  // Manager actions for one side (0 = away, 1 = home). Each returns an error or null.
  setAutoPitching(side: 0 | 1, on: boolean): void;
  warmUp(side: 0 | 1, pid: number): string | null;
  sitDown(side: 0 | 1, pid: number): void;
  bringIn(side: 0 | 1, pid: number): string | null;
  moundVisit(side: 0 | 1): string | null;
  intentionalWalk(side: 0 | 1): string | null;
  pinchHit(side: 0 | 1, pid: number): string | null;
  pinchRun(side: 0 | 1, base: number, pid: number): string | null;
  defensiveSub(side: 0 | 1, slot: number, pid: number): string | null;
  switchPositions(side: 0 | 1, a: number, b: number): string | null;
  setTactic(side: 0 | 1, t: Tactic): string | null;
}

const WARM_READY = 3; // plate appearances of warming before a reliever is loose
const FIELD_NAMES: Record<string, string> = { C: 'catcher', '1B': 'first', '2B': 'second', '3B': 'third', SS: 'short', LF: 'left', CF: 'center', RF: 'right' };

// Rest status shown on the bullpen card (no randomness, unlike the manager's own read).
export function restStatus(p: Player, day: number): string {
  const d = day - p.lastPitchedDay;
  if (p.lastStartDay > day - 4) return 'Starter, resting';
  if (d <= 0) return 'Pitched today';
  if (d === 1) return p.consecutiveDays >= 2 ? `Tired (${p.consecutiveDays + 1} straight days)` : `Pitched yesterday (${p.lastPitchCount})`;
  if (d === 2 && p.lastPitchCount > 45) return 'Tired';
  return 'Rested';
}

export function simGame(home: GameLineup, away: GameLineup, opts: GameOpts): GameOutput {
  const g = createGame(home, away, opts);
  while (!g.done()) g.step();
  return g.finish();
}

export function createGame(home: GameLineup, away: GameLineup, opts: GameOpts): GameEngine {
  // Day-to-day form: everyone is a little better or worse on a given day, so
  // the best teams lose more often than their ratings alone would say.
  // A shared team component matters most: independent player noise averages
  // out over nine hitters, but a whole club having a good or bad day doesn't.
  const teamDay = new Map<number, number>([[home.orgId, normal(0, 3)], [away.orgId, normal(0, 3)]]);
  const formMap = new Map<number, number>();
  const form = (p: Player) => {
    let f = formMap.get(p.id);
    if (f === undefined) { f = clamp(normal(0, 2.5) + (p.orgId !== null ? (teamDay.get(p.orgId) ?? 0) : 0), -9, 9); formMap.set(p.id, f); }
    return f;
  };
  const level = home.level;
  const env = ENV[level];
  // Big-league workloads and intensity: a bit more injury risk than the minors.
  const injLevel = level === 'MLB' ? 1.5 : 1;
  const injuries: InjuryEvent[] = [];
  const injured = new Set<number>();
  const live = !!opts.live;

  const mgrOf = (p: Player) => (home.sp === p || home.bullpen.includes(p) ? home.mgr : away.mgr);
  const makeApp = (p: Player, isStarter: boolean, inning: number, lead: number, outsAtEntry: number): PitcherApp => {
    const line = emptyPit();
    line.g = 1;
    if (isStarter) line.gs = 1;
    return {
      p,
      line,
      box: { pid: p.id, outs: 0, h: 0, r: 0, er: 0, bb: 0, k: 0, hr: 0, pitches: 0, dec: '' },
      isStarter,
      limit: pitchLimit(p, isStarter, level) * (0.93 + rand() * 0.12) * (isStarter ? mgrOf(p).hook : 1),
      faced: new Map(),
      runsThisOuting: 0,
      entryLead: lead,
      saveSit: !isStarter && lead > 0 && lead <= 3,
      blown: false,
      enteredInning: inning,
      outsAtEntry,
      boost: 0,
      visitedInning: null,
      coldPen: 0,
      coldPAs: 0,
    };
  };

  const refreshDefense = (side: Side) => {
    const d = teamDefense(side.order);
    side.defense = d.def;
    side.errRating = d.err;
    side.ofArm = d.ofArm;
    side.catcher = d.catcher;
    side.tdp = d.tdp;
  };

  const makeSide = (lu: GameLineup): Side => {
    const sp = makeApp(lu.sp, true, 1, 0, 0);
    const side: Side = {
      lu,
      order: lu.batters.map((b) => ({ ...b })),
      next: 0,
      pitcher: sp,
      apps: [sp],
      used: new Set([lu.sp.id]),
      runs: 0,
      hits: 0,
      errors: 0,
      lineScore: [],
      defense: 0,
      errRating: 0,
      ofArm: 0,
      catcher: null,
      tdp: 0,
      bat: new Map(),
    };
    refreshDefense(side);
    for (const { p, pos } of lu.batters) {
      const line = emptyBat();
      line.g = 1;
      line.gs = 1;
      side.bat.set(p.id, { line, box: { pid: p.id, pos, ab: 0, r: 0, h: 0, rbi: 0, bb: 0, k: 0, hr: 0, d: 0, t: 0 } });
    }
    return side;
  };

  const H = makeSide(home);
  const A = makeSide(away);
  const sides = [A, H]; // index by half: 0 = top (away bats), 1 = bottom

  let inning = 1;
  let half = 0;
  let outs = 0;
  let bases: (Runner | null)[] = [null, null, null];
  let gameOver = false;
  let halfOpen = false;
  // Pitcher-of-record tracking
  let leader: 0 | 1 | -1 = -1; // which side index leads (0 away, 1 home), -1 tie
  let wCand: [PitcherApp | null, PitcherApp | null] = [null, null];
  let lCand: [PitcherApp | null, PitcherApp | null] = [null, null];

  // Live-game state
  const log: PlayEvent[] = [];
  let scored: Player[] = [];
  const tactic: [Tactic, Tactic] = [{}, {}];
  const autoPitch: [boolean, boolean] = [true, true];
  const needPitcher: [boolean, boolean] = [false, false];
  const warm: [Map<number, number>, Map<number, number>] = [new Map(), new Map()];
  const warmPitches = new Map<number, number>();
  const visitsLeft: [number, number] = [5, 5];
  const removed = new Set<number>(); // players who have left the game

  const nm = (p: Player) => p.last;
  const say = (text: string) => {
    if (!live) return;
    const runs = scored.length ? ` ${scored.map(nm).join(' and ')} ${scored.length > 1 ? 'score' : 'scores'}.` : '';
    log.push({ inning, half, outs, away: A.runs, home: H.runs, text: text + runs, scoring: scored.length > 0 });
    scored = [];
  };
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];

  const leadFor = (s: number) => sides[s].runs - sides[1 - s].runs;

  const batEntry = (side: Side, p: Player) => side.bat.get(p.id)!;

  const chargeRun = (bs: Side, fs: Side, r: Runner, rbi: Player | null) => {
    bs.runs++;
    bs.lineScore[bs.lineScore.length - 1]++;
    if (live) scored.push(r.p);
    const be = bs.bat.get(r.p.id);
    if (be) {
      be.line.r++;
      be.box.r++;
    }
    if (rbi) {
      const rb = bs.bat.get(rbi.id);
      if (rb) {
        rb.line.rbi++;
        rb.box.rbi++;
      }
    }
    r.resp.line.r++;
    r.resp.box.r++;
    r.resp.runsThisOuting++;
    if (r.earned) {
      r.resp.line.er++;
      r.resp.box.er++;
    }
    // lead changes / ties
    const bIdx = sides.indexOf(bs) as 0 | 1;
    const lead = leadFor(bIdx);
    const cur = fs.pitcher;
    if (cur.saveSit && leadFor(1 - bIdx) <= 0) cur.blown = true;
    if (lead === 1 && leader !== bIdx) {
      leader = bIdx;
      wCand[bIdx] = bs.pitcher;
      lCand[1 - bIdx] = r.resp;
    } else if (lead === 0) {
      leader = -1;
      wCand = [null, null];
      lCand = [null, null];
    }
  };

  const reliefPick = (fs: Side, lead: number): Player | null => {
    const relievers = fs.lu.bullpen.filter((p) => p.pos !== 'SP');
    const pen = relievers.length >= 6 ? relievers : fs.lu.bullpen;
    const avail = pen.filter((p) => {
      if (fs.used.has(p.id) || injured.has(p.id)) return false;
      const daysSince = opts.day - p.lastPitchedDay;
      if (daysSince <= 0) return false;
      if (daysSince === 1 && (p.lastPitchCount > 22 || p.consecutiveDays >= 2 || rand() < 0.45)) return false;
      if (daysSince === 2 && p.lastPitchCount > 45) return false;
      if (p.lastStartDay > opts.day - 4) return false;
      // Workload: at most three times in any five days, or four in a week.
      const recent = (p.recentApps ?? []).filter((d) => d > opts.day - 7 && d < opts.day);
      if (recent.length >= 4 || recent.filter((d) => d > opts.day - 6).length >= 3) return false;
      if (daysSince === 1 && recent.filter((d) => d > opts.day - 3).length >= 2) return false;
      return true;
    });
    if (avail.length === 0) {
      const any = fs.lu.bullpen.filter((p) => !fs.used.has(p.id) && !injured.has(p.id) && p.lastStartDay < opts.day - 2);
      return any.sort((a, b) => a.lastPitchedDay - b.lastPitchedDay)[0] ?? null;
    }
    const has = (p: Player | null) => p !== null && avail.includes(p);
    const role = (p: Player) => fs.lu.roles.get(p.id) ?? 'MR';
    const best = (ps: Player[]) => [...ps].sort((a, b) => b.ratings.pit.stuff + b.ratings.pit.control - (a.ratings.pit.stuff + a.ratings.pit.control))[0];
    // Pick by role; fall back through the other roles in a sensible order.
    const byRole = (order: PenRole[]): Player | null => {
      for (const r of order) {
        const ps = avail.filter((p) => role(p) === r);
        if (!ps.length) continue;
        if (r === 'SU') {
          // The first setup man (by depth chart order) gets the 8th.
          for (const s of inning >= 8 ? fs.lu.setup : [...fs.lu.setup].reverse()) if (has(s)) return s;
        }
        if (r === 'LR') return [...ps].sort((a, b) => b.ratings.pit.stamina - a.ratings.pit.stamina)[0];
        if (r === 'MU') return [...ps].sort((a, b) => a.ratings.pit.stuff - b.ratings.pit.stuff)[0];
        // Better managers pick the right arm more often.
        if (rand() > fs.lu.mgr.bullpenSkill) return ps[Math.floor(rand() * ps.length)];
        return best(ps);
      }
      return null;
    };
    const save = lead > 0 && lead <= 3;
    if (inning >= 9 && (save || (lead === 0 && half === 0)) && has(fs.lu.closer)) return fs.lu.closer;
    if (Math.abs(lead) >= 5) return byRole(['MU', 'LR', 'MR', 'SU', 'CL']);
    if (inning <= 5) return byRole(['LR', 'MR', 'MU', 'SU', 'CL']);
    if (inning >= 10) return byRole(['LR', 'MR', 'SU', 'MU', 'CL']);
    if (inning >= 7 && lead >= 0 && lead <= 3) return byRole(inning === 7 ? ['SU', 'MR', 'MU', 'LR', 'CL'] : ['SU', 'MR', 'CL', 'MU', 'LR']);
    return byRole(['MR', 'MU', 'SU', 'LR', 'CL']);
  };

  const installPitcher = (fs: Side, fIdx: number, np: Player) => {
    const lead = leadFor(fIdx);
    const app = makeApp(np, false, inning, lead, outs);
    // Brought in before he was loose: worse for his first few hitters.
    const w = warm[fIdx].get(np.id) ?? 0;
    if (live && w < WARM_READY) {
      app.coldPen = (WARM_READY - w) * 2.5;
      app.coldPAs = 3;
    }
    warm[fIdx].delete(np.id);
    fs.apps.push(app);
    fs.used.add(np.id);
    fs.pitcher = app;
    needPitcher[fIdx] = false;
    if (live) say(`Pitching change: ${np.first} ${np.last} replaces ${nm(fs.apps[fs.apps.length - 2].p)}.`);
  };

  // The manager gets someone loose when trouble is coming (live games only, so
  // simmed games are unchanged).
  const aiWarm = (fs: Side, fIdx: number) => {
    if (warm[fIdx].size > 0) return;
    const a = fs.pitcher;
    const pc = a.line.pitches;
    const lead = leadFor(fIdx);
    const trouble = a.isStarter
      ? pc >= a.limit * 0.78 || a.runsThisOuting >= 4 || (inning >= 6 && pc >= a.limit * 0.7)
      : pc >= a.limit * 0.6 || a.runsThisOuting >= 2 || (a.line.outs >= 2 && inning >= 7);
    const lateClose = inning >= 8 && lead >= 0 && lead <= 3 && fs.lu.closer !== a.p && !fs.used.has(fs.lu.closer?.id ?? -1);
    if (!trouble && !lateClose) return;
    const cand = lateClose && !trouble && fs.lu.closer && !injured.has(fs.lu.closer.id) ? fs.lu.closer : reliefPick(fs, lead);
    if (!cand || fs.used.has(cand.id)) return;
    warm[fIdx].set(cand.id, 0);
    say(`${cand.first} ${cand.last} is warming up in the ${fIdx === 1 ? 'home' : 'visitors\''} bullpen.`);
  };

  const changePitcher = (fs: Side, fIdx: number) => {
    // Go to whoever is already loose, if anyone.
    const warmed = live ? [...warm[fIdx].entries()].filter(([id]) => !fs.used.has(id) && !injured.has(id)).sort((x, y) => y[1] - x[1])[0] : undefined;
    const wp = warmed ? fs.lu.bullpen.find((p) => p.id === warmed[0]) : undefined;
    const np = wp ?? reliefPick(fs, leadFor(fIdx));
    if (!np) return false;
    installPitcher(fs, fIdx, np);
    return true;
  };

  const shouldPull = (fs: Side, fIdx: number): boolean => {
    const a = fs.pitcher;
    const pc = a.line.pitches;
    if (injured.has(a.p.id)) return true;
    if (a.isStarter) {
      if (pc >= a.limit) return true;
      if (a.runsThisOuting >= 7) return true;
      if (a.runsThisOuting >= 5 && inning >= 3 && rand() < 0.5) return true;
      if (inning >= 6 && pc > a.limit * 0.82 && bases.some(Boolean) && rand() < 0.35) return true;
      const tto = a.faced.get(fs === H ? A.order[A.next].p.id : H.order[H.next].p.id) ?? 0;
      if (tto >= 3 && inning >= 6 && rand() < fs.lu.mgr.ttoPull) return true;
      return false;
    }
    if (pc >= a.limit) return true;
    if (a.runsThisOuting >= 3 && pc > 15) return true;
    // relievers normally go one inning; long men may go longer
    const outsRecorded = a.line.outs;
    if (outs === 0 && outsRecorded >= 3 && inning > a.enteredInning) {
      const long = a.p.ratings.pit.stamina >= 38 && Math.abs(leadFor(fIdx)) >= 4;
      if (long && outsRecorded < 9) return false;
      // An efficient middle or long man often stays for a second inning.
      const role = fs.lu.roles.get(a.p.id);
      const stay = role === 'LR' || role === 'MU' ? 0.65 : role === 'MR' ? 0.4 : 0.08;
      if (outsRecorded < 6 && pc < 18 && a.runsThisOuting === 0 && rand() < stay) return false;
      return true;
    }
    return false;
  };

  const pitchesFor = (ev: string): number => {
    let n: number;
    if (ev === 'K') n = Math.round(4.8 + normal(0, 1.1));
    else if (ev === 'BB') n = Math.round(5.7 + normal(0, 0.8));
    else if (ev === 'HBP') n = Math.round(2.8 + normal(0, 1.3));
    else n = Math.round(3.25 + normal(0, 1.5));
    const min = ev === 'K' ? 3 : ev === 'BB' ? 4 : 1;
    return Math.max(min, n);
  };

  const addPitches = (app: PitcherApp, n: number) => {
    app.line.pitches += n;
    app.box.pitches += n;
    // per-pitch injury risk
    const pr = 0.00017 * opts.injuryRate * injLevel * app.p.injuryProne * n * (home.sp === app.p || home.bullpen.includes(app.p) ? home.pInjury : away.pInjury);
    if (!injured.has(app.p.id) && rand() < pr) {
      const inj = rollInjury(true);
      injured.add(app.p.id);
      injuries.push({ p: app.p, ...inj });
      if (live) say(`${app.p.first} ${app.p.last} is hurt (${inj.name}) and has to leave the game.`);
    }
  };

  const recordOut = (fs: Side, n = 1) => {
    outs += n;
    fs.pitcher.line.outs += n;
    fs.pitcher.box.outs += n;
  };

  const advanceForced = (bs: Side, fs: Side, batterRunner: Runner) => {
    // walk / HBP: force runners
    if (bases[0]) {
      if (bases[1]) {
        if (bases[2]) chargeRun(bs, fs, bases[2], batterRunner.p);
        bases[2] = bases[1];
      }
      bases[1] = bases[0];
    }
    bases[0] = batterRunner;
  };

  const spdF = (p: Player) => sc(p.ratings.run.speed * 0.6 + p.ratings.run.baserunning * 0.4, 0.25);

  // Steal attempt by the lead runner (second, or third if second is occupied and third open).
  const attemptSteal = (bs: Side, fs: Side, app: PitcherApp, called: boolean): boolean => {
    const third = !!bases[1] && !bases[2];
    const idx = third ? 1 : 0;
    const r = bases[idx];
    if (!r) return false;
    addPitches(app, 1 + (rand() < 0.5 ? 1 : 0));
    const cArm = fs.catcher ? fs.catcher.ratings.def.cArm : 40;
    const succ = oddsAdj(third ? 0.72 : 0.78, sc(r.p.ratings.run.steal, 0.35) / sc(cArm, 0.25)) * (called ? 0.97 : 1);
    const rb = bs.bat.get(r.p.id);
    const bag = third ? 'third' : 'second';
    if (rand() < succ) {
      bases[idx + 1] = r;
      bases[idx] = null;
      if (rb) rb.line.sb++;
      say(`${nm(r.p)} stole ${bag}.`);
      return false;
    }
    bases[idx] = null;
    if (rb) rb.line.cs++;
    recordOut(fs);
    say(`${nm(r.p)} was caught stealing ${bag}.`);
    return outs >= 3;
  };

  const playPA = (bs: Side, fs: Side, bIdx: number) => {
    const slot = bs.order[bs.next];
    const batter = slot.p;
    const app = fs.pitcher;
    const pit = app.p;
    const be = batEntry(bs, batter);
    const pr = pit.ratings.pit;
    const bt = tactic[bIdx];
    const ft = tactic[1 - bIdx];
    tactic[bIdx] = {};
    // Infield in stays on until the manager changes it.

    // stolen base attempts: called by the manager, or on his own read
    if (bt.steal && (bases[0] || bases[1]) && !(bases[0] && bases[1] && bases[2])) {
      if (attemptSteal(bs, fs, app, true)) return;
    } else if (!bt.bunt && !bt.hitRun && bases[0] && !bases[1] && outs < 2) {
      const r = bases[0];
      const att = clamp(0.17 * env.sb * bs.lu.mgr.steal * sc(r.p.ratings.run.steal, 0.45), 0.004, 0.45);
      if (rand() < att) {
        if (attemptSteal(bs, fs, app, false)) return;
      }
    }

    // wild pitch / passed ball
    if (bases.some(Boolean)) {
      const cAbil = fs.catcher ? fs.catcher.ratings.def.cAbil : 35;
      if (rand() < 0.007 * sc(cAbil, -0.2) * sc(pr.control, -0.15)) {
        if (bases[2]) {
          const r = bases[2];
          bases[2] = null;
          chargeRun(bs, fs, r, null);
        }
        bases = [null, bases[0], bases[1]];
        say('Wild pitch; the runners move up.');
      }
    }

    // fatigue & times through the order
    const pc = app.line.pitches;
    const over = Math.max(0, pc - 0.75 * app.limit) / (0.25 * app.limit);
    const fatigue = over * 6 * (app.boost > 0 ? 0.6 : 1);
    const times = app.faced.get(batter.id) ?? 0;
    app.faced.set(batter.id, times + 1);
    const tto = times >= 2 ? 2.5 + (times - 2) * 1.5 : 0;
    const sameHand = batter.bats !== 'S' && batter.bats === pit.throws ? 1.5 : 0;
    const cold = app.coldPAs > 0 ? app.coldPen : 0;
    const settle = app.boost > 0 ? 3 : 0;
    if (app.coldPAs > 0) app.coldPAs--;
    if (app.boost > 0) app.boost--;

    const pm = moraleBoost(pit) + form(pit);
    const stuff = soft(pr.stuff) - fatigue - tto + sameHand - cold + pm;
    const control = soft(pr.control) - fatigue * 0.8 - tto * 0.5 - cold + settle + pm;
    const movement = soft(pr.movement) - fatigue * 0.8 - tto + sameHand * 0.5 - cold * 0.5 + pm;
    const raw = pit.throws === 'L' ? batter.ratings.vL : batter.ratings.vR;
    const bm = moraleBoost(batter) + form(batter) + OFFENSE_ADJ;
    const split = { ...raw, avoidK: soft(raw.avoidK) + bm, eye: soft(raw.eye) + bm, power: soft(raw.power) + bm, babip: soft(raw.babip) + bm, gap: soft(raw.gap) + bm };
    const speed = batter.ratings.run.speed;

    be.line.pa++;
    app.line.bf++;

    // Sacrifice bunt.
    if (bt.bunt && (bases[0] || bases[1]) && outs < 2) {
      addPitches(app, 1 + (rand() < 0.6 ? 1 : 0));
      const skill = clamp(0.72 * sc(split.avoidK, 0.15), 0.45, 0.9);
      const x = rand();
      const hitChance = clamp(0.06 * sc(speed, 0.35), 0.02, 0.2);
      const lead = bases[1] ? 1 : 0;
      if (x < hitChance) {
        be.line.ab++;
        be.box.ab++;
        be.line.h++;
        be.box.h++;
        app.line.h++;
        app.box.h++;
        bs.hits++;
        const [r1, r2, r3] = bases;
        if (r3) chargeRun(bs, fs, r3, batter);
        bases = [{ p: batter, resp: app, earned: true }, r1, r2];
        say(`${nm(batter)} beat out a bunt for a single.`);
      } else if (x < hitChance + skill) {
        // Sacrifice: everyone moves up a base, batter out.
        recordOut(fs);
        const [r1, r2, r3] = bases;
        if (r3 && outs < 3) chargeRun(bs, fs, r3, batter);
        bases = [null, r1, r2];
        say(`${nm(batter)} laid down a sacrifice bunt.`);
      } else if (x < hitChance + skill + 0.2) {
        // Lead runner thrown out; batter safe at first.
        be.line.ab++;
        be.box.ab++;
        recordOut(fs);
        const [r1, , r3] = bases;
        bases = [{ p: batter, resp: app, earned: true }, lead === 1 ? r1 : null, r3];
        say(`${nm(batter)} bunted into a force out at ${lead === 1 ? 'third' : 'second'}.`);
      } else {
        be.line.ab++;
        be.box.ab++;
        recordOut(fs);
        say(`${nm(batter)} popped up the bunt attempt.`);
      }
      bs.next = (bs.next + 1) % 9;
      return;
    }

    const hitRun = !!bt.hitRun && !!bases[0] && !bases[1] && outs < 2;
    const pK = log5(L_K * sc(split.avoidK, -0.22), L_K * sc(stuff, 0.15), L_K) * (hitRun ? 0.88 : 1);
    const pBB = log5(L_BB * sc(split.eye, 0.25), L_BB * sc(control, -0.25), L_BB) * env.bb * (hitRun ? 0.8 : 1);
    const pHBP = L_HBP * sc(control, -0.1);
    const infieldIn = !!ft.infieldIn && !!bases[2] && outs < 2;

    const r = rand();
    let ev: string;
    if (r < pK) ev = 'K';
    else if (r < pK + pBB) ev = 'BB';
    else if (r < pK + pBB + pHBP) ev = 'HBP';
    else {
      const pHR = log5(L_HR_BIP * sc(split.power, 0.27), L_HR_BIP * Math.exp((-0.22 * (movement - 50) - 0.08 * (pr.gb - 50)) / 10), L_HR_BIP);
      if (rand() < pHR * env.hr) ev = 'HR';
      else {
        let pH = log5(L_BABIP * Math.exp((0.1 * (split.babip - 50) + 0.03 * (speed - 50)) / 10), L_BABIP * Math.exp((-0.05 * (movement - 50) - 0.03 * (stuff - 50)) / 10), L_BABIP);
        pH = oddsAdj(pH, sc(fs.defense, -0.09) * env.babip);
        if (infieldIn) pH += 0.035; // more grounders get through a drawn-in infield
        if (rand() < pH) {
          const p2 = clamp(L_2B_SHARE * Math.exp((0.25 * (split.gap - 50) + 0.08 * (split.power - 50)) / 10), 0.05, 0.5);
          const p3 = clamp(L_3B_SHARE * Math.exp((0.4 * (speed - 50) + 0.15 * (split.gap - 50)) / 10), 0.002, 0.12);
          const x = rand();
          ev = x < p3 ? '3B' : x < p3 + p2 ? '2B' : '1B';
        } else {
          const gbShare = clamp(0.45 * Math.exp((0.15 * (pr.gb - 50) - 0.1 * (split.power - 50)) / 10), 0.25, 0.7);
          const e = rand() < 0.016 * env.err * sc(fs.errRating, -0.2);
          ev = e ? 'E' : rand() < gbShare ? 'GB' : rand() < 0.22 ? 'PU' : rand() < 0.35 ? 'LD' : 'FB';
        }
      }
    }

    addPitches(app, pitchesFor(ev));
    const bRunner: Runner = { p: batter, resp: app, earned: true };
    const who = nm(batter);

    switch (ev) {
      case 'K':
        be.line.ab++;
        be.line.k++;
        be.box.ab++;
        be.box.k++;
        app.line.k++;
        app.box.k++;
        recordOut(fs);
        say(`${who} struck out ${rand() < 0.27 ? 'looking' : 'swinging'}.`);
        // Hit-and-run with a swing and miss: the runner is on his own.
        if (hitRun && outs < 3 && bases[0]) attemptSteal(bs, fs, app, true);
        break;
      case 'BB':
      case 'HBP':
        if (ev === 'BB') {
          be.line.bb++;
          be.box.bb++;
          app.line.bb++;
          app.box.bb++;
        } else {
          be.line.hbp++;
          app.line.hbp++;
        }
        advanceForced(bs, fs, bRunner);
        say(ev === 'BB' ? `${who} walked.` : `${who} was hit by a pitch.`);
        break;
      case 'HR': {
        be.line.ab++;
        be.line.h++;
        be.line.hr++;
        be.box.ab++;
        be.box.h++;
        be.box.hr++;
        app.line.h++;
        app.line.hr++;
        app.box.h++;
        app.box.hr++;
        bs.hits++;
        const n = 1 + bases.filter(Boolean).length;
        for (let i = 2; i >= 0; i--) {
          const rr = bases[i];
          if (rr) chargeRun(bs, fs, rr, batter);
        }
        bases = [null, null, null];
        chargeRun(bs, fs, bRunner, batter);
        scored = [];
        say(`${who} homered to ${pick(['left', 'left-center', 'center', 'right-center', 'right'])}${n === 4 ? ' (grand slam!)' : n > 1 ? ` (${n} runs)` : ''}.`);
        break;
      }
      case '1B':
      case '2B':
      case '3B': {
        be.line.ab++;
        be.line.h++;
        be.box.ab++;
        be.box.h++;
        app.line.h++;
        app.box.h++;
        bs.hits++;
        if (ev === '2B') {
          be.line.d++;
          be.box.d++;
        }
        if (ev === '3B') {
          be.line.t++;
          be.box.t++;
        }
        const armF = sc(fs.ofArm, -0.15);
        const [r1, r2, r3] = bases;
        const nb: (Runner | null)[] = [null, null, null];
        if (ev === '3B') {
          for (const rr of [r3, r2, r1]) if (rr) chargeRun(bs, fs, rr, batter);
          nb[2] = bRunner;
        } else if (ev === '2B') {
          if (r3) chargeRun(bs, fs, r3, batter);
          if (r2) chargeRun(bs, fs, r2, batter);
          if (r1) {
            if (rand() < clamp((hitRun ? 0.6 : 0.42) * spdF(r1.p) * armF, 0.1, 0.9)) chargeRun(bs, fs, r1, batter);
            else nb[2] = r1;
          }
          nb[1] = bRunner;
        } else {
          if (r3) chargeRun(bs, fs, r3, batter);
          if (r2) {
            if (rand() < clamp(0.6 * spdF(r2.p) * armF, 0.2, 0.92)) chargeRun(bs, fs, r2, batter);
            else nb[2] = r2;
          }
          if (r1) {
            if (!nb[2] && rand() < (hitRun ? 0.8 : clamp(0.28 * spdF(r1.p) * armF, 0.05, 0.6))) nb[2] = r1;
            else nb[1] = r1;
          }
          nb[0] = bRunner;
        }
        bases = nb;
        const verb = ev === '1B' ? 'singled' : ev === '2B' ? 'doubled' : 'tripled';
        say(`${who} ${verb} to ${pick(ev === '1B' ? ['left', 'center', 'right', 'left', 'right'] : ['left', 'left-center', 'center', 'right-center', 'right'])}.`);
        break;
      }
      case 'E': {
        be.line.ab++;
        be.box.ab++;
        fs.errors++;
        bRunner.earned = false;
        const [r1, r2, r3] = bases;
        if (r3) chargeRun(bs, fs, { ...r3, earned: false }, null);
        bases = [bRunner, r1, r2];
        say(`${who} reached on an error by the ${pick(['shortstop', 'third baseman', 'second baseman', 'first baseman', 'left fielder', 'center fielder', 'right fielder'])}.`);
        break;
      }
      case 'GB': {
        be.line.ab++;
        be.box.ab++;
        const [r1, r2, r3] = bases;
        const fielder = pick(['short', 'second', 'third', 'first', 'short', 'second', 'the pitcher']);
        if (r1 && outs < 2) {
          // Runner going on the pitch: no double play.
          const dpP = hitRun ? 0 : clamp(0.36 * sc(speed, -0.2) * sc(fs.tdp, 0.15), 0.08, 0.65);
          if (rand() < dpP) {
            be.line.gidp++;
            recordOut(fs, 2);
            const nb: (Runner | null)[] = [null, null, null];
            if (outs < 3) {
              if (r3) chargeRun(bs, fs, r3, null);
              if (r2) nb[2] = r2;
            }
            bases = nb;
            say(`${who} grounded into a double play.`);
            break;
          }
          recordOut(fs);
          const fc = !hitRun && rand() < 0.55; // lead runner forced at second, batter safe
          const nb: (Runner | null)[] = [null, null, null];
          if (fc) nb[0] = bRunner;
          else nb[1] = r1;
          if (r2) nb[2] = r2;
          if (r3 && outs < 3) {
            if (nb[2] || rand() < (infieldIn ? 0.1 : 0.5)) chargeRun(bs, fs, r3, batter);
            else nb[2] = r3;
          }
          bases = nb;
          say(fc ? `${who} reached on a fielder's choice; ${nm(r1.p)} out at second.` : `${who} grounded out to ${fielder}${hitRun ? `; ${nm(r1.p)} moves to second` : ''}.`);
          break;
        }
        recordOut(fs);
        if (outs < 3) {
          const nb: (Runner | null)[] = [null, null, null];
          let thirdFree = true;
          if (r3) {
            if (rand() < (infieldIn ? 0.1 : 0.5)) chargeRun(bs, fs, r3, batter);
            else {
              nb[2] = r3;
              thirdFree = false;
            }
          }
          if (r2) {
            if (thirdFree && rand() < 0.55) nb[2] = r2;
            else nb[1] = r2;
          }
          bases = nb;
        }
        say(`${who} grounded out to ${fielder}.`);
        break;
      }
      case 'FB':
      case 'LD':
      case 'PU': {
        const [r1, r2, r3] = bases;
        recordOut(fs);
        const field = ev === 'PU' ? pick(['short', 'second', 'third', 'first', 'the catcher']) : ev === 'LD' ? pick(['short', 'second', 'third', 'left', 'center', 'right']) : pick(['left', 'center', 'right']);
        if (ev === 'FB' && r3 && outs < 3 && rand() < clamp(0.6 * spdF(r3.p), 0.25, 0.9)) {
          be.line.sf++;
          bases[2] = null;
          chargeRun(bs, fs, r3, batter);
          if (r2 && rand() < 0.25) {
            bases[2] = r2;
            bases[1] = null;
          }
          say(`${who} hit a sacrifice fly to ${field}.`);
        } else {
          be.line.ab++;
          be.box.ab++;
          if (ev === 'FB' && r2 && !r3 && outs < 3 && rand() < 0.25) {
            bases[2] = r2;
            bases[1] = null;
          }
          if (ev === 'LD' && r1 && outs < 3 && rand() < (hitRun ? 0.3 : 0.04)) {
            bases[0] = null;
            recordOut(fs);
            say(`${who} lined into a double play.`);
          } else {
            say(`${who} ${ev === 'PU' ? 'popped out to' : ev === 'LD' ? 'lined out to' : 'flied out to'} ${field}.`);
          }
        }
        break;
      }
    }

    // position player injury
    if (!injured.has(batter.id) && rand() < 0.00065 * opts.injuryRate * injLevel * batter.injuryProne * bs.lu.medical) {
      const inj = rollInjury(false);
      injured.add(batter.id);
      injuries.push({ p: batter, ...inj });
      // replace from the bench
      const bench = bs.lu.bench.filter((b) => !injured.has(b.id) && !bs.bat.has(b.id));
      if (bench.length) {
        const pos = slot.pos;
        const rep =
          pos === 'DH' || pos === 'SP' || pos === 'RP'
            ? bench[0]
            : [...bench].sort((a, b) => posRating(b.ratings.def, pos as FieldPos) - posRating(a.ratings.def, pos as FieldPos))[0];
        const line = emptyBat();
        line.g = 1;
        bs.bat.set(rep.id, { line, box: { pid: rep.id, pos: slot.pos, ab: 0, r: 0, h: 0, rbi: 0, bb: 0, k: 0, hr: 0, d: 0, t: 0 } });
        bs.order[bs.next] = { p: rep, pos: slot.pos };
        removed.add(batter.id);
        for (const b of bases) if (b && b.p === batter) b.p = rep;
        refreshDefense(bs);
        say(`${batter.first} ${batter.last} left the game hurt (${inj.name}); ${rep.first} ${rep.last} replaces him.`);
      }
    }

    void bIdx;
    bs.next = (bs.next + 1) % 9;
  };

  const MAX_INN = 25;

  const openHalf = () => {
    const bs = sides[half];
    const fs = sides[1 - half];
    bs.lineScore.push(0);
    outs = 0;
    bases = [null, null, null];
    if (inning > 9 && opts.ghostRunner) {
      const prev = bs.order[(bs.next + 8) % 9].p;
      bases[1] = { p: prev, resp: fs.pitcher, earned: false };
    }
    // bottom of 9th+ skipped if home already ahead
    if (half === 1 && inning >= 9 && H.runs > A.runs) {
      bs.lineScore.pop();
      gameOver = true;
      return;
    }
    halfOpen = true;
    if (live) say(`${half === 0 ? 'Top' : 'Bottom'} of the ${ordinal(inning)}.${bases[1] ? ` ${nm(bases[1].p)} starts at second.` : ''}`);
  };

  const closeHalf = () => {
    halfOpen = false;
    for (const s of sides) s.pitcher.visitedInning = null;
    if (half === 1) {
      if (inning >= 9 && H.runs !== A.runs) gameOver = true;
      else if (inning >= MAX_INN) gameOver = true;
      inning++;
      half = 0;
    } else {
      // Home team ahead after the top of the 9th (or later): game over.
      if (inning >= 9 && H.runs > A.runs) gameOver = true;
      half = 1;
    }
    if (gameOver && live) say(`Final: ${A.runs}-${H.runs}.`);
  };

  // One plate appearance (plus the moves around it).
  const step = () => {
    if (gameOver) return;
    if (!halfOpen) {
      openHalf();
      if (gameOver) {
        if (live) say(`Final: ${A.runs}-${H.runs}.`);
        return;
      }
    }
    const bIdx = half;
    const bs = sides[bIdx];
    const fIdx = 1 - bIdx;
    const fs = sides[fIdx];
    if (autoPitch[fIdx]) {
      if (shouldPull(fs, fIdx)) changePitcher(fs, fIdx);
      if (live) aiWarm(fs, fIdx);
    } else if (injured.has(fs.pitcher.p.id)) {
      // Your pitcher is hurt: you have to make a change.
      needPitcher[fIdx] = true;
      return;
    }
    if (needPitcher[fIdx]) return;
    // Relievers warming up get looser with every hitter.
    for (const w of warm) for (const [id, n] of w) {
      w.set(id, n + 1);
      warmPitches.set(id, (warmPitches.get(id) ?? 0) + 4);
    }
    playPA(bs, fs, bIdx);
    if (half === 1 && inning >= 9 && H.runs > A.runs) {
      gameOver = true;
      if (live) say(`Walk-off! Final: ${A.runs}-${H.runs}.`);
      return;
    }
    if (outs >= 3) closeHalf();
  };

  const finish = (): GameOutput => {
    // Decisions
    const homeWon = H.runs > A.runs;
    const win = homeWon ? H : A;
    const lose = homeWon ? A : H;
    const wIdx = homeWon ? 1 : 0;
    let wApp = wCand[wIdx] ?? win.apps[0];
    if (wApp.isStarter && wApp.line.outs < 15 && win.apps.length > 1) {
      const relievers = win.apps.slice(1);
      wApp = relievers.sort((a, b) => b.line.outs - a.line.outs)[0];
    }
    const lApp = lCand[1 - wIdx] ?? lose.apps[lose.apps.length - 1];
    wApp.line.w = 1;
    wApp.box.dec = 'W';
    lApp.line.l = 1;
    lApp.box.dec = 'L';
    let svPid: number | null = null;
    const finisher = win.apps[win.apps.length - 1];
    if (finisher !== wApp && !finisher.isStarter) {
      const margin = win.runs - lose.runs;
      if ((finisher.entryLead > 0 && finisher.entryLead <= 3 && finisher.line.outs >= 1) || finisher.line.outs >= 9 || (margin <= 3 && finisher.line.outs >= 3)) {
        finisher.line.sv = 1;
        finisher.box.dec = 'S';
        svPid = finisher.p.id;
      }
    }
    for (const side of [H, A]) {
      for (const a of side.apps) {
        if (a.isStarter || a === finisher || a.line.w || a.line.l) continue;
        if (a.saveSit && !a.blown && a.line.outs >= 1) {
          a.line.hld = 1;
          a.box.dec = 'H';
        }
      }
      for (const a of side.apps) if (a.blown && a.saveSit) a.line.bs = 1;
    }

    const batLines: GameOutput['batLines'] = [];
    const pitLines: GameOutput['pitLines'] = [];
    const allBatters = (side: Side) => [...side.order.map((o) => o.p), ...side.lu.batters.map((b) => b.p), ...side.lu.bench];
    for (const side of [H, A]) {
      for (const [, v] of side.bat) {
        const p = allBatters(side).find((x) => x.id === v.box.pid);
        if (p) batLines.push({ p, orgId: side.lu.orgId, line: v.line });
      }
      for (const a of side.apps) pitLines.push({ p: a.p, orgId: side.lu.orgId, line: a.line, isStarter: a.isStarter });
    }
    // fielding errors charged loosely to the fielders for record keeping
    for (const side of [H, A]) {
      if (side.errors) {
        const fielders = side.order.filter((o) => o.pos !== 'DH');
        for (let i = 0; i < side.errors; i++) {
          const f = fielders[Math.floor(rand() * fielders.length)];
          const e = side.bat.get(f.p.id);
          if (e) e.line.e++;
        }
      }
    }

    const box: BoxScore = {
      gid: opts.gid,
      level,
      day: opts.day,
      home: home.orgId,
      away: away.orgId,
      lineScore: { away: A.lineScore, home: H.lineScore },
      hits: { away: A.hits, home: H.hits },
      errors: { away: A.errors, home: H.errors },
      bat: { away: [...A.bat.values()].map((v) => v.box), home: [...H.bat.values()].map((v) => v.box) },
      pit: { away: A.apps.map((a) => a.box), home: H.apps.map((a) => a.box) },
      notes: injuries.map((i) => `${i.p.first} ${i.p.last} left with ${i.name}`),
    };

    // Relievers who warmed up but didn't pitch still threw.
    const pitched = new Set([...H.apps, ...A.apps].map((a) => a.p.id));
    const warmed = [...warmPitches.entries()].filter(([id, n]) => !pitched.has(id) && n >= 8).map(([id, n]) => ({ p: [...home.bullpen, ...away.bullpen].find((x) => x.id === id)!, pitches: Math.min(25, n) })).filter((x) => x.p);

    return {
      homeRuns: H.runs,
      awayRuns: A.runs,
      innings: Math.max(9, A.lineScore.length),
      batLines,
      pitLines,
      injuries,
      box,
      wp: wApp.p.id,
      lp: lApp.p.id,
      sv: svPid,
      warmed,
    };
  };

  // ---------- live view and manager actions ----------

  const benchFor = (s: Side) => s.lu.bench.filter((b) => !s.bat.has(b.id) && !injured.has(b.id) && !removed.has(b.id));
  const penFor = (s: Side) => s.lu.bullpen.filter((p) => !s.used.has(p.id) && !injured.has(p.id));

  const liveSide = (s: Side, idx: number): LiveSide => ({
    orgId: s.lu.orgId,
    runs: s.runs,
    hits: s.hits,
    errors: s.errors,
    lineScore: [...s.lineScore],
    order: s.order.map((o) => ({ p: o.p, pos: o.pos, line: s.bat.get(o.p.id)!.line })),
    next: s.next,
    pitcher: { p: s.pitcher.p, line: s.pitcher.line, isStarter: s.pitcher.isStarter, cold: s.pitcher.coldPAs > 0 },
    apps: s.apps.map((a) => ({ p: a.p, line: a.line })),
    bench: benchFor(s),
    bullpen: penFor(s).map((p) => {
      const w = warm[idx].get(p.id);
      const role = s.lu.roles.get(p.id) ?? null;
      return { p, role, status: role || p.pos !== 'SP' ? restStatus(p, opts.day) : 'Starter (emergency only)', warm: w ?? -1, ready: (w ?? 0) >= WARM_READY };
    }),
    visitsLeft: visitsLeft[idx],
    autoPitching: autoPitch[idx],
    needPitcher: needPitcher[idx] || (injured.has(s.pitcher.p.id) && !autoPitch[idx]),
    infieldIn: !!tactic[idx].infieldIn,
  });

  const fielding = (side: 0 | 1) => half !== side;
  // Start the half-inning if it hasn't begun (e.g. a move before the leadoff hitter).
  const ensureHalf = (): boolean => {
    if (gameOver) return false;
    if (!halfOpen) openHalf();
    return !gameOver;
  };
  const batting = (side: 0 | 1) => half === side;

  return {
    step,
    done: () => gameOver,
    finish,
    state: () => ({
      inning,
      half,
      outs: halfOpen ? outs : 0,
      bases: halfOpen ? bases.map((b) => b?.p ?? null) : [null, null, null],
      over: gameOver,
      sides: [liveSide(A, 0), liveSide(H, 1)],
      batter: sides[half].order[sides[half].next].p,
      pitcher: sides[1 - half].pitcher.p,
      log,
    }),
    setAutoPitching: (side, on) => {
      autoPitch[side] = on;
    },
    warmUp: (side, pid) => {
      const s = sides[side];
      if (!penFor(s).some((p) => p.id === pid)) return 'Not available';
      if (warm[side].size >= 2 && !warm[side].has(pid)) return 'Two relievers are already warming up';
      if (!warm[side].has(pid)) warm[side].set(pid, 0);
      return null;
    },
    sitDown: (side, pid) => {
      warm[side].delete(pid);
    },
    bringIn: (side, pid) => {
      const s = sides[side];
      const p = penFor(s).find((x) => x.id === pid);
      if (!p) return 'Not available';
      if (gameOver) return 'The game is over';
      // Three-batter minimum, unless he's hurt or the inning is over.
      const cur = s.pitcher;
      if (!injured.has(cur.p.id) && fielding(side) && halfOpen && cur.line.bf < 3) return `${nm(cur.p)} has to face three batters or finish the inning first`;
      installPitcher(s, side, p);
      return null;
    },
    moundVisit: (side) => {
      if (!fielding(side)) return 'Only while you are in the field';
      if (!ensureHalf()) return 'The game is over';
      if (visitsLeft[side] <= 0) return 'No mound visits left';
      const app = sides[side].pitcher;
      if (app.visitedInning === inning) return 'A second visit this inning would remove him';
      visitsLeft[side]--;
      app.visitedInning = inning;
      app.boost = 2;
      if (live) say(`Mound visit for ${nm(app.p)}.`);
      return null;
    },
    intentionalWalk: (side) => {
      if (!fielding(side)) return 'Only while you are in the field';
      if (!ensureHalf()) return 'The game is over';
      if (needPitcher[side]) return 'Make a pitching change first';
      const bIdx = half;
      const bs = sides[bIdx];
      const fs = sides[side];
      const batter = bs.order[bs.next].p;
      const be = batEntry(bs, batter);
      be.line.pa++;
      be.line.bb++;
      be.box.bb++;
      fs.pitcher.line.bf++;
      fs.pitcher.line.bb++;
      fs.pitcher.box.bb++;
      advanceForced(bs, fs, { p: batter, resp: fs.pitcher, earned: true });
      say(`${nm(batter)} was intentionally walked.`);
      bs.next = (bs.next + 1) % 9;
      if (half === 1 && inning >= 9 && H.runs > A.runs) gameOver = true;
      return null;
    },
    pinchHit: (side, pid) => {
      if (!batting(side)) return 'Only while you are batting';
      const s = sides[side];
      const rep = benchFor(s).find((b) => b.id === pid);
      if (!rep) return 'Not available';
      const slot = s.order[s.next];
      const line = emptyBat();
      line.g = 1;
      s.bat.set(rep.id, { line, box: { pid: rep.id, pos: slot.pos, ab: 0, r: 0, h: 0, rbi: 0, bb: 0, k: 0, hr: 0, d: 0, t: 0 } });
      removed.add(slot.p.id);
      say(`${rep.first} ${rep.last} pinch-hits for ${nm(slot.p)}.`);
      s.order[s.next] = { p: rep, pos: slot.pos };
      return null;
    },
    pinchRun: (side, base, pid) => {
      if (!batting(side)) return 'Only while you are batting';
      const s = sides[side];
      const runner = bases[base];
      if (!runner) return 'Nobody on that base';
      const rep = benchFor(s).find((b) => b.id === pid);
      if (!rep) return 'Not available';
      const k = s.order.findIndex((o) => o.p.id === runner.p.id);
      if (k < 0) return 'Runner not in the lineup';
      const line = emptyBat();
      line.g = 1;
      s.bat.set(rep.id, { line, box: { pid: rep.id, pos: s.order[k].pos, ab: 0, r: 0, h: 0, rbi: 0, bb: 0, k: 0, hr: 0, d: 0, t: 0 } });
      removed.add(runner.p.id);
      say(`${rep.first} ${rep.last} pinch-runs for ${nm(runner.p)} at ${['first', 'second', 'third'][base]}.`);
      s.order[k] = { p: rep, pos: s.order[k].pos };
      runner.p = rep;
      return null;
    },
    defensiveSub: (side, slot, pid) => {
      const s = sides[side];
      const rep = benchFor(s).find((b) => b.id === pid);
      if (!rep) return 'Not available';
      const cur = s.order[slot];
      if (!cur) return 'No such lineup spot';
      if (batting(side) && halfOpen && bases.some((b) => b?.p === cur.p)) return 'He is on base: use a pinch runner';
      const line = emptyBat();
      line.g = 1;
      s.bat.set(rep.id, { line, box: { pid: rep.id, pos: cur.pos, ab: 0, r: 0, h: 0, rbi: 0, bb: 0, k: 0, hr: 0, d: 0, t: 0 } });
      removed.add(cur.p.id);
      say(`${rep.first} ${rep.last} replaces ${nm(cur.p)}${cur.pos !== 'DH' ? `, playing ${FIELD_NAMES[cur.pos] ?? cur.pos}` : ''}.`);
      s.order[slot] = { p: rep, pos: cur.pos };
      refreshDefense(s);
      return null;
    },
    switchPositions: (side, a, b) => {
      const s = sides[side];
      const x = s.order[a];
      const y = s.order[b];
      if (!x || !y) return 'No such lineup spot';
      [x.pos, y.pos] = [y.pos, x.pos];
      const bx = s.bat.get(x.p.id);
      const by = s.bat.get(y.p.id);
      if (bx) bx.box.pos = x.pos;
      if (by) by.box.pos = y.pos;
      refreshDefense(s);
      say(`${nm(x.p)} moves to ${x.pos}, ${nm(y.p)} to ${y.pos}.`);
      return null;
    },
    setTactic: (side, t) => {
      if (t.infieldIn !== undefined) {
        tactic[side].infieldIn = t.infieldIn;
        return null;
      }
      if (!batting(side)) return 'Only while you are batting';
      if (t.steal && !(bases[0] || bases[1])) return 'Nobody to send';
      if (t.bunt && (!(bases[0] || bases[1]) || outs >= 2)) return 'Bunt with a runner on first or second and fewer than two outs';
      if (t.hitRun && !(bases[0] && !bases[1] && outs < 2)) return 'Hit-and-run needs a runner on first only and fewer than two outs';
      tactic[side] = { ...t, infieldIn: tactic[side].infieldIn };
      return null;
    },
  };
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
