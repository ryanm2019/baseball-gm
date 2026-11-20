// Plate-appearance level game simulation.
//
// Each plate appearance is resolved with the odds-ratio (log5) method: the
// batter's rate for an event, the pitcher's rate, and the league rate combine
// into a matchup probability. Ratings move a player's rate up or down from the
// league average. Pitch counts are simulated per PA to drive fatigue, pitcher
// hooks and bullpen workload.
import type { BatStats, BoxBatLine, BoxPitLine, BoxScore, FieldPos, Level, PitStats, Player, Pos } from '../types.ts';
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

export function simGame(home: GameLineup, away: GameLineup, opts: { gid: number; day: number; injuryRate: number; ghostRunner: boolean }): GameOutput {
  const level = home.level;
  const env = ENV[level];
  const injuries: InjuryEvent[] = [];
  const injured = new Set<number>();

  const makeApp = (p: Player, isStarter: boolean, inning: number, lead: number, outsAtEntry: number): PitcherApp => {
    const line = emptyPit();
    line.g = 1;
    if (isStarter) line.gs = 1;
    return {
      p,
      line,
      box: { pid: p.id, outs: 0, h: 0, r: 0, er: 0, bb: 0, k: 0, hr: 0, pitches: 0, dec: '' },
      isStarter,
      limit: pitchLimit(p, isStarter, level) * (0.93 + rand() * 0.12),
      faced: new Map(),
      runsThisOuting: 0,
      entryLead: lead,
      saveSit: !isStarter && lead > 0 && lead <= 3,
      blown: false,
      enteredInning: inning,
      outsAtEntry,
    };
  };

  const makeSide = (lu: GameLineup): Side => {
    const d = teamDefense(lu.batters);
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
      defense: d.def,
      errRating: d.err,
      ofArm: d.ofArm,
      catcher: d.catcher,
      tdp: d.tdp,
      bat: new Map(),
    };
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
  // Pitcher-of-record tracking
  let leader: 0 | 1 | -1 = -1; // which side index leads (0 away, 1 home), -1 tie
  let wCand: [PitcherApp | null, PitcherApp | null] = [null, null];
  let lCand: [PitcherApp | null, PitcherApp | null] = [null, null];

  const leadFor = (s: number) => sides[s].runs - sides[1 - s].runs;

  const batEntry = (side: Side, p: Player) => side.bat.get(p.id)!;

  const chargeRun = (bs: Side, fs: Side, r: Runner, rbi: Player | null) => {
    bs.runs++;
    bs.lineScore[bs.lineScore.length - 1]++;
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
      return true;
    });
    if (avail.length === 0) {
      const any = fs.lu.bullpen.filter((p) => !fs.used.has(p.id) && !injured.has(p.id) && p.lastStartDay < opts.day - 2);
      return any.sort((a, b) => a.lastPitchedDay - b.lastPitchedDay)[0] ?? null;
    }
    const has = (p: Player | null) => p !== null && avail.includes(p);
    if (inning >= 9 && lead > 0 && lead <= 3 && has(fs.lu.closer)) return fs.lu.closer;
    if (inning >= 9 && lead === 0 && has(fs.lu.closer) && half === 0) return fs.lu.closer;
    if (inning >= 7 && lead >= 0 && lead <= 3) {
      for (const s of fs.lu.setup) if (has(s)) return s;
    }
    const others = avail.filter((p) => p !== fs.lu.closer && !fs.lu.setup.includes(p));
    const pool = others.length ? others : avail;
    if (inning <= 5) return [...pool].sort((a, b) => b.ratings.pit.stamina - a.ratings.pit.stamina)[0];
    if (Math.abs(lead) >= 5) return [...pool].sort((a, b) => a.ratings.pit.stuff - b.ratings.pit.stuff)[0];
    return [...pool].sort((a, b) => b.ratings.pit.stuff + b.ratings.pit.control - (a.ratings.pit.stuff + a.ratings.pit.control))[0];
  };

  const changePitcher = (fs: Side, fIdx: number) => {
    const lead = leadFor(fIdx);
    const np = reliefPick(fs, lead);
    if (!np) return false;
    const app = makeApp(np, false, inning, lead, outs);
    fs.apps.push(app);
    fs.used.add(np.id);
    fs.pitcher = app;
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
      if (tto >= 3 && inning >= 6 && rand() < 0.3) return true;
      return false;
    }
    if (pc >= a.limit) return true;
    if (a.runsThisOuting >= 3 && pc > 15) return true;
    // relievers normally go one inning; long men may go longer
    const outsRecorded = a.line.outs;
    if (outs === 0 && outsRecorded >= 3 && inning > a.enteredInning) {
      const long = a.p.ratings.pit.stamina >= 38 && Math.abs(leadFor(fIdx)) >= 4;
      return !long || outsRecorded >= 9;
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
    const pr = 0.00017 * opts.injuryRate * app.p.injuryProne * n;
    if (!injured.has(app.p.id) && rand() < pr) {
      const inj = rollInjury(true);
      injured.add(app.p.id);
      injuries.push({ p: app.p, ...inj });
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

  const playPA = (bs: Side, fs: Side, bIdx: number) => {
    const slot = bs.order[bs.next];
    const batter = slot.p;
    const app = fs.pitcher;
    const pit = app.p;
    const be = batEntry(bs, batter);
    const pr = pit.ratings.pit;

    // stolen base attempts
    if (bases[0] && !bases[1] && outs < 2) {
      const r = bases[0];
      const att = clamp(0.17 * env.sb * sc(r.p.ratings.run.steal, 0.45), 0.004, 0.45);
      if (rand() < att) {
        addPitches(app, 1 + (rand() < 0.5 ? 1 : 0));
        const cArm = fs.catcher ? fs.catcher.ratings.def.cArm : 40;
        const succ = oddsAdj(0.78, sc(r.p.ratings.run.steal, 0.35) / sc(cArm, 0.25));
        const rb = bs.bat.get(r.p.id);
        if (rand() < succ) {
          bases[1] = r;
          bases[0] = null;
          if (rb) rb.line.sb++;
        } else {
          bases[0] = null;
          if (rb) rb.line.cs++;
          recordOut(fs);
          if (outs >= 3) return;
        }
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
      }
    }

    // fatigue & times through the order
    const pc = app.line.pitches;
    const over = Math.max(0, pc - 0.75 * app.limit) / (0.25 * app.limit);
    const fatigue = over * 6;
    const times = app.faced.get(batter.id) ?? 0;
    app.faced.set(batter.id, times + 1);
    const tto = times >= 2 ? 2.5 + (times - 2) * 1.5 : 0;
    const sameHand = batter.bats !== 'S' && batter.bats === pit.throws ? 1.5 : 0;

    const stuff = pr.stuff - fatigue - tto + sameHand;
    const control = pr.control - fatigue * 0.8 - tto * 0.5;
    const movement = pr.movement - fatigue * 0.8 - tto + sameHand * 0.5;
    const split = pit.throws === 'L' ? batter.ratings.vL : batter.ratings.vR;
    const speed = batter.ratings.run.speed;

    const pK = log5(L_K * sc(split.avoidK, -0.22), L_K * sc(stuff, 0.15), L_K);
    const pBB = log5(L_BB * sc(split.eye, 0.25), L_BB * sc(control, -0.25), L_BB) * env.bb;
    const pHBP = L_HBP * sc(control, -0.1);

    be.line.pa++;
    app.line.bf++;
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

    switch (ev) {
      case 'K':
        be.line.ab++;
        be.line.k++;
        be.box.ab++;
        be.box.k++;
        app.line.k++;
        app.box.k++;
        recordOut(fs);
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
        for (let i = 2; i >= 0; i--) {
          const rr = bases[i];
          if (rr) chargeRun(bs, fs, rr, batter);
        }
        bases = [null, null, null];
        chargeRun(bs, fs, bRunner, batter);
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
            if (rand() < clamp(0.42 * spdF(r1.p) * armF, 0.1, 0.85)) chargeRun(bs, fs, r1, batter);
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
            if (!nb[2] && rand() < clamp(0.28 * spdF(r1.p) * armF, 0.05, 0.6)) nb[2] = r1;
            else nb[1] = r1;
          }
          nb[0] = bRunner;
        }
        bases = nb;
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
        break;
      }
      case 'GB': {
        be.line.ab++;
        be.box.ab++;
        const [r1, r2, r3] = bases;
        if (r1 && outs < 2) {
          const dpP = clamp(0.36 * sc(speed, -0.2) * sc(fs.tdp, 0.15), 0.08, 0.65);
          if (rand() < dpP) {
            be.line.gidp++;
            recordOut(fs, 2);
            const nb: (Runner | null)[] = [null, null, null];
            if (outs < 3) {
              if (r3) chargeRun(bs, fs, r3, null);
              if (r2) nb[2] = r2;
            }
            bases = nb;
            break;
          }
          recordOut(fs);
          const fc = rand() < 0.55; // lead runner forced at second, batter safe
          const nb: (Runner | null)[] = [null, null, null];
          if (fc) nb[0] = bRunner;
          else nb[1] = r1;
          if (r2) nb[2] = r2;
          if (r3 && outs < 3) {
            if (nb[2] || rand() < 0.5) chargeRun(bs, fs, r3, batter);
            else nb[2] = r3;
          }
          bases = nb;
          break;
        }
        recordOut(fs);
        if (outs < 3) {
          const nb: (Runner | null)[] = [null, null, null];
          let thirdFree = true;
          if (r3) {
            if (rand() < 0.5) chargeRun(bs, fs, r3, batter);
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
        break;
      }
      case 'FB':
      case 'LD':
      case 'PU': {
        const [r1, r2, r3] = bases;
        recordOut(fs);
        if (ev === 'FB' && r3 && outs < 3 && rand() < clamp(0.6 * spdF(r3.p), 0.25, 0.9)) {
          be.line.sf++;
          bases[2] = null;
          chargeRun(bs, fs, r3, batter);
          if (r2 && rand() < 0.25) {
            bases[2] = r2;
            bases[1] = null;
          }
        } else {
          be.line.ab++;
          be.box.ab++;
          if (ev === 'FB' && r2 && !r3 && outs < 3 && rand() < 0.25) {
            bases[2] = r2;
            bases[1] = null;
          }
          if (ev === 'LD' && r1 && outs < 3 && rand() < 0.04) {
            bases[0] = null;
            recordOut(fs);
          }
        }
        void r1;
        break;
      }
    }

    // position player injury
    if (!injured.has(batter.id) && rand() < 0.00065 * opts.injuryRate * batter.injuryProne) {
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
        for (const b of bases) if (b && b.p === batter) b.p = rep;
      }
    }

    void bIdx;
    bs.next = (bs.next + 1) % 9;
  };

  const MAX_INN = 25;
  while (!gameOver) {
    const bIdx = half;
    const bs = sides[bIdx];
    const fs = sides[1 - bIdx];
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
      break;
    }
    while (outs < 3) {
      if (shouldPull(fs, 1 - bIdx)) {
        const before = fs.pitcher;
        if (changePitcher(fs, 1 - bIdx)) {
          // inherited runners stay charged to the previous pitcher
          void before;
        }
      }
      playPA(bs, fs, bIdx);
      if (half === 1 && inning >= 9 && H.runs > A.runs) {
        gameOver = true;
        break;
      }
    }
    if (gameOver) break;
    if (half === 1) {
      if (inning >= 9 && H.runs !== A.runs) gameOver = true;
      else if (inning >= MAX_INN) gameOver = true;
      inning++;
      half = 0;
    } else {
      half = 1;
    }
  }

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
  for (const side of [H, A]) {
    for (const [, v] of side.bat) {
      const p = side.order.find((o) => o.p.id === v.box.pid)?.p ?? side.lu.batters.find((b) => b.p.id === v.box.pid)?.p ?? side.lu.bench.find((b) => b.id === v.box.pid);
      if (p) batLines.push({ p, orgId: side.lu.orgId, line: v.line });
    }
    for (const a of side.apps) pitLines.push({ p: a.p, orgId: side.lu.orgId, line: a.line, isStarter: a.isStarter });
  }
  // fielding errors charged loosely to the shortstop/third base for record keeping
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
  };
}
