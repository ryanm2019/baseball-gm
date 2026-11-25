// The amateur draft, held at the All-Star break: draft class generation, the
// lottery for the top six picks, slot values and bonus pools, and signings.
import type { DraftInfo, DraftPick, DraftState, League, Player } from './types.ts';
import { generatePlayer } from './playerGen.ts';
import { clamp, normal, rand, seededNormal, shuffle } from './random.ts';
import { ovr, pitcherOvr, potOvr, scoutFactor } from './ratings.ts';
import { warFor } from './value.ts';
import { milbContract, roundSalary } from './contracts.ts';
import { addNews, addTransaction, pname, touchRosters } from './util.ts';
import { agmEvalSd, delegated, staffOf } from './staff.ts';
import { cbtOverLastSeason } from './owners.ts';
import type { CbPick, DraftAdjust } from './types.ts';
import { logMove, side } from './moves.ts';
import { posLabel } from './rules.ts';
import { addInbox } from './morale.ts';
import { fmtMoney } from './contracts.ts';

export function normalizeAdjust(a: unknown): DraftAdjust {
  const x = (a ?? { comp: [], forfeit: [] }) as { comp: unknown[]; forfeit: unknown[] };
  return {
    comp: x.comp.map((c) => (typeof c === 'number' ? { orgId: c, after: 'CBB' as const } : (c as DraftAdjust['comp'][0]))),
    forfeit: x.forfeit.map((f) => (typeof f === 'number' ? { orgId: f, round: 2 } : (f as DraftAdjust['forfeit'][0]))),
    unsigned: ((x as { unsigned?: DraftAdjust['unsigned'] }).unsigned ?? []).slice(),
  };
}

// Competitive Balance Rounds: the smallest markets get extra picks after
// rounds 1 (A) and 2 (B). These are the only tradable draft picks.
export function generateCbPicks(league: League, season: number): void {
  const bySize = [...league.orgs].sort((a, b) => a.market - b.market);
  const picks: CbPick[] = [];
  bySize.slice(0, 6).forEach((o) => picks.push({ id: `${season}-A-${o.id}`, season, round: 'A', originalOrg: o.id, orgId: o.id }));
  bySize.slice(6, 14).forEach((o) => picks.push({ id: `${season}-B-${o.id}`, season, round: 'B', originalOrg: o.id, orgId: o.id }));
  league.cbPicks = [...(league.cbPicks ?? []).filter((c) => c.season !== season), ...picks];
}

const LOTTERY_ODDS = [16.5, 16.5, 16.5, 13.25, 10, 7.5, 5.5, 3.9, 2.7, 1.8, 1.4, 1.1, 0.9, 0.7, 0.5, 0.4, 0.3, 0.2];
export const POOL_ROUNDS = 10;
export const LATE_ROUND_FREE = 150_000;

export function slotValue(overall: number, round: number): number {
  if (round <= 2) return roundSalary(11_000_000 * Math.exp(-(overall - 1) / 26));
  if (round <= POOL_ROUNDS) return roundSalary(Math.max(150_000, 900_000 * Math.exp(-(overall - 61) / 110)));
  return LATE_ROUND_FREE;
}

export function generateDraftClass(league: League, season: number): void {
  const n = Math.round(league.orgs.length * league.settings.draftRounds * 1.3);
  for (let i = 0; i < n; i++) {
    const college = rand() < 0.55;
    const p = generatePlayer({
      id: league.nextId.player++,
      season,
      level: college ? 'A' : 'CPX',
      orgId: null,
      age: college ? (rand() < 0.6 ? 21 : 22) : rand() < 0.75 ? 18 : 17,
      international: false,
      // College players are more polished: more of the class's top talent is in college.
      talentShift: college ? normal(0.8, 2.5) : normal(-2, 2.5),
    });
    p.level = null;
    p.proSeasons = 0;
    p.prospect = { year: season, college, ...amateurProfile(season - p.born, college) };
    amateurTraits(p, college);
    milbContract(p, season, 'A');
    league.players[p.id] = p;
  }
  // Most classes have one or two generational talents; some have none.
  const r = rand();
  const stars = r < 0.25 ? 0 : r < 0.75 ? 1 : 2;
  for (let k = 0; k < stars; k++) {
    let best: Player | null = null;
    for (let t = 0; t < 12; t++) {
      const college = rand() < 0.45;
      const p = generatePlayer({
        id: league.nextId.player,
        season,
        level: college ? 'A' : 'CPX',
        orgId: null,
        age: college ? 21 : rand() < 0.75 ? 18 : 17,
        international: false,
        talentShift: normal(college ? 9 : 7, 2),
      });
      if (!best || potOvr(p) > potOvr(best)) best = p;
      if (potOvr(p) >= 72) break;
    }
    if (!best) continue;
    league.nextId.player++;
    best.level = null;
    best.proSeasons = 0;
    best.prospect = { year: season, college: season - best.born >= 20, ...amateurProfile(season - best.born, season - best.born >= 20) };
    amateurTraits(best, best.prospect.college);
    milbContract(best, season, 'A');
    league.players[best.id] = best;
  }
}

// High schoolers' development swings more widely (more busts, more late
// bloomers); college players have a higher floor. About a third of amateur
// relievers have the frame to build a starter's stamina.
function amateurTraits(p: Player, college: boolean): void {
  p.devVol = college ? 0.8 : 1.5;
  if (p.pos === 'RP' && rand() < 0.35) p.pot.stamina = Math.max(p.pot.stamina, clamp(normal(54, 6), 46, 68));
}

// What a prospect is worth to a club, in hitter-equivalent overall: a rating
// counts for the WAR it produces (a reliever's far less than a starter's), and
// clubs bank on only part of the projection, less for high schoolers (further
// away, riskier). A reliever who can build stamina is valued as a starter, a
// little discounted.
export function draftTalent(p: Player, potRead: number, curRead: number): number {
  const hs = !p.prospect?.college;
  const pot = Math.max(curRead, potRead);
  const exp = curRead + (hs ? 0.55 : 0.72) * (pot - curRead);
  const eq = (x: number, q: Player) => 42 + warFor(q, x) / 0.22;
  let v = 0.7 * eq(exp, p) + 0.3 * eq(pot, p);
  if (p.pos === 'RP' && p.pot.stamina >= 45) {
    const asSp = pitcherOvr(p.pot.stuff, p.pot.movement, p.pot.control, p.pot.stamina, 'SP') + (pot - potOvr(p));
    const sp = { ...p, pos: 'SP' } as Player;
    const expSp = curRead + (hs ? 0.55 : 0.72) * (asSp - curRead);
    v = Math.max(v, 0.7 * eq(expSp, sp) + 0.3 * eq(asSp, sp) - 2);
  }
  return v;
}

// ---------- signability ----------

// High schoolers' leverage is their college commitment; draft-eligible juniors
// can go back to school; seniors have nowhere else to go.
export function amateurProfile(age: number, college: boolean): { cls: 'HS' | 'JR' | 'SR'; commit?: number } {
  if (college) return { cls: age >= 22 ? 'SR' : 'JR' };
  const r = rand();
  const commit = r < 0.3 ? 0.75 + 0.25 * rand() : r < 0.7 ? 0.35 + 0.35 * rand() : 0.05 + 0.3 * rand();
  return { cls: 'HS', commit };
}

export function leverage(info: DraftInfo): number {
  const cls = info.cls ?? (info.college ? 'JR' : 'HS');
  if (cls === 'SR') return 0.05;
  if (cls === 'JR') return 0.35;
  return 0.5 + 0.9 * (info.commit ?? 0.5);
}

// How a club's scouts read his signability (noisier with worse amateur scouting).
export function signabilityLabel(league: League, p: Player, orgId = league.userOrgId): string {
  const info = p.prospect!;
  const cls = info.cls ?? (info.college ? 'JR' : 'HS');
  if (cls === 'SR') return 'College senior: signs cheap';
  if (cls === 'JR') return 'College junior: can return to school';
  const sd = 0.12 * scoutFactor(league, league.orgs[orgId], 'amateur');
  const seen = (info.commit ?? 0.5) + sd * seededNormal(p.scoutSeed, orgId + 1, 6161);
  if (seen >= 0.75) return 'Tough sign: strong college commitment';
  if (seen >= 0.4) return 'College commitment: will cost over slot';
  return 'Signable';
}

function prospectValue(p: Player): number {
  return 0.72 * potOvr(p) + 0.28 * ovr(p);
}

// What a pick wants: his slot, pulled up toward what his talent is worth if he
// fell, and pushed up by his leverage. Seniors take what they can get.
function setDemand(league: League, pick: DraftPick, p: Player): void {
  const info = p.prospect!;
  const v = prospectValue(p);
  const rank = Object.values(league.players).filter((q) => isProspect(q, league.season) && prospectValue(q) > v).length;
  const per = Math.max(30, Math.round(league.draft ? league.draft.picks.length / league.settings.draftRounds : 36));
  const expRound = Math.floor(rank / per) + 1;
  const worth = expRound <= POOL_ROUNDS ? slotValue(rank + 1, expRound) : LATE_ROUND_FREE;
  // Asking multiple over his slot: strongly committed high schoolers want up to
  // ~1.35x, juniors about slot, seniors take roughly half.
  const cls = info.cls ?? (info.college ? 'JR' : 'HS');
  const mult = cls === 'SR' ? 0.4 + 0.25 * rand() : cls === 'JR' ? 0.88 + 0.14 * rand() : 0.85 + 0.45 * Math.pow(info.commit ?? 0.5, 1.5);
  // A player who fell below his talent wants part of the difference.
  const base = Math.max(pick.slot, 0.65 * pick.slot + 0.35 * worth);
  let demand: number;
  if (pick.round > POOL_ROUNDS) demand = (cls === 'HS' ? Math.max(LATE_ROUND_FREE, worth) * mult * 1.4 : Math.min(LATE_ROUND_FREE, Math.max(40_000, worth * mult))) * Math.exp(normal(0, 0.12));
  else demand = base * mult * Math.exp(normal(0, 0.08));
  info.asking = Math.max(20_000, roundSalary(demand));
  info.stiff = 1;
}

// Demand today: most players soften as the deadline nears; strongly committed
// high schoolers don't. Lowball offers stiffen it.
export function demandNow(league: League, info: DraftInfo): number {
  const d = league.draft;
  const progress = d ? clamp((league.day - league.settings.draftDay) / Math.max(1, d.deadline - league.settings.draftDay), 0, 1) : 0;
  const soften = info.cls === 'HS' && (info.commit ?? 0) > 0.7 ? 0 : 0.12 * progress;
  return (info.asking ?? info.slot ?? LATE_ROUND_FREE) * (info.stiff ?? 1) * (1 - soften);
}

function acceptChance(info: DraftInfo, amount: number, demand: number): number {
  const w = 0.06 + 0.04 * leverage(info);
  return 1 / (1 + Math.exp(-(amount / demand - 1) / w));
}

// The meter: how likely he is to accept, as your scouts read it.
export function willingness(league: League, p: Player, amount: number, orgId = league.userOrgId): number {
  const info = p.prospect!;
  const misread = Math.exp(0.14 * scoutFactor(league, league.orgs[orgId], 'amateur') * seededNormal(p.scoutSeed, orgId + 1, 5150));
  return acceptChance(info, amount, demandNow(league, info) * misread);
}

export function willingnessBand(x: number): string {
  return x < 0.1 ? 'No chance' : x < 0.35 ? 'Unlikely' : x < 0.65 ? '50/50' : x < 0.9 ? 'Likely' : 'Will sign';
}

// One official offer per pick per day.
export function offerPick(league: League, pk: DraftPick, amount: number): { signed: boolean; text: string } {
  if (pk.pid === null || pk.signed !== null) return { signed: false, text: 'Not available' };
  const p = league.players[pk.pid];
  const info = p?.prospect;
  if (!info) return { signed: false, text: 'Not available' };
  if (info.lastOffer === league.day) return { signed: false, text: `You already made ${pname(p)} an offer today.` };
  amount = Math.max(10_000, roundSalary(amount));
  const d = demandNow(league, info);
  info.lastOffer = league.day;
  info.lastAmount = amount;
  if (rand() < acceptChance(info, amount, d)) {
    signPick(league, pk, p, true, amount);
    if (pk.round > POOL_ROUNDS && amount >= 750_000) addNews(league, null, `Day 3 steal? The ${league.orgs[pk.orgId].affiliates.MLB.name} signed round ${pk.round} pick ${posLabel(p)} ${pname(p)} for ${(amount / 1e6).toFixed(2)}M, buying him out of his college commitment.`, [p.id]);
    return { signed: true, text: `${pname(p)} signed for ${(amount / 1e6).toFixed(2)}M.` };
  }
  if (amount < d * 0.8) {
    info.stiff = Math.min(1.15, (info.stiff ?? 1) * 1.04);
    return { signed: false, text: `${pname(p)}'s camp was insulted by the offer. His price went up.` };
  }
  return { signed: false, text: `${pname(p)} turned it down${amount >= d * 0.97 ? ', but it was close' : ''}.` };
}

// AI clubs (and your assistant GM, if he has the draft) negotiate every day of
// the signing period, mostly staying inside their pools.
export function draftSigningDay(league: League): void {
  const d = league.draft;
  if (!d || !d.done || league.day >= d.deadline) return;
  const user = league.orgs[league.userOrgId];
  const agmSigned: DraftPick[] = [];
  for (const pk of d.picks) {
    if (pk.pid === null || pk.signed !== null) continue;
    const isUser = pk.orgId === league.userOrgId;
    if (isUser && !delegated(league, user, 'draft')) continue;
    const p = league.players[pk.pid];
    const info = p?.prospect;
    if (!info || info.lastOffer === league.day) continue;
    // What his scouts think he wants.
    const misread = (x: Player, org: number) => Math.exp(0.14 * scoutFactor(league, league.orgs[org], 'amateur') * seededNormal(x.scoutSeed, org + 1, 5150));
    const want = demandNow(league, info) * misread(p, pk.orgId);
    const aggressive = league.orgs[pk.orgId].owner.type === 'Big spender' || league.orgs[pk.orgId].owner.type === 'Win-now';
    // Budget: the pool, less what's spent, less what the club expects its other
    // unsigned top-10-round picks to cost (at most their slots).
    const others = d.picks.filter((x) => x !== pk && x.orgId === pk.orgId && x.round <= POOL_ROUNDS && x.pid !== null && x.signed === null);
    // Reserve each other unsigned pick's full slot: if he doesn't sign, that slot leaves the pool.
    const expected = others.reduce((t, x) => t + x.slot, 0);
    // Clubs will pay the 75% tax to go up to 5% over, never into pick-losing territory.
    const stretch = aggressive ? 1.045 : 1.035;
    // The cushion only applies to money that's certain (if others don't sign, the pool shrinks).
    const room = (poolTotal(league, pk.orgId) - expected) * stretch - poolSpent(league, pk.orgId);
    // Start near what the scouts think he wants; after a "no", come up.
    let offer = Math.max(want * (1 + rand() * 0.08), (info.lastAmount ?? 0) * (1.05 + rand() * 0.04));
    if (pk.round <= POOL_ROUNDS) {
      // Top-10-round picks get signed: an unsigned pick's slot leaves the pool.
      offer = Math.min(offer, room);
    } else {
      // Late rounds: $150k, plus only real savings. A Day 3 flyer on a
      // committed high schooler gets most of the savings (and the 5% cushion).
      const savings = poolTotal(league, pk.orgId) - poolSpent(league, pk.orgId) - others.reduce((t, x) => t + x.slot, 0);
      const flyer = info.cls === 'HS' && (info.commit ?? 0) > 0.7 && prospectValue(p) >= 44;
      const share = flyer ? Math.max(0, room - Math.max(0, savings)) + Math.max(0, savings) * 0.9 : Math.max(0, savings) * 0.3;
      offer = Math.min(offer, LATE_ROUND_FREE + share);
    }
    if (offer < want * 0.75) continue; // can't afford him
    if (offerPick(league, pk, offer).signed && isUser) agmSigned.push(pk);
  }
  // Your assistant GM signed some of your picks today: let you know.
  if (agmSigned.length) {
    addInbox(league, {
      from: 'Assistant GM', subject: `Signed ${agmSigned.length} draft pick${agmSigned.length === 1 ? '' : 's'}`, kind: 'info', pids: agmSigned.map((pk) => pk.pid!),
      text: `${agmSigned.map((pk) => `round ${pk.round} ${posLabel(league.players[pk.pid!])} ${pname(league.players[pk.pid!])} (${fmtMoney(pk.bonus ?? 0)}, slot ${fmtMoney(pk.slot)})`).join('; ')}. Bonus pool: ${fmtMoney(poolSpent(league, user.id))} of ${fmtMoney(poolTotal(league, user.id))} spent.`,
    });
  }
}

export const isProspect = (p: Player, season?: number) => !!p.prospect && p.orgId === null && (season === undefined || p.prospect.year === season);

function draftValue(league: League, orgId: number, p: Player): number {
  const org = league.orgs[orgId];
  const fd = staffOf(league, org, 'FD');
  const base = orgId === league.userOrgId ? agmEvalSd(league, org) : fd ? Math.max(1, ((80 - fd.evaluation) / 60) * 5) : 5;
  // High schoolers are harder to project: their potential is read with more noise.
  const sd = base * scoutFactor(league, org, 'amateur') * (p.prospect?.college ? 1 : 1.5);
  const noise = sd * seededNormal(p.scoutSeed, orgId, 4242);
  // Clubs shy away from tough signs, more so once the premium picks are gone
  // and when their pool can't cover an over-slot deal.
  const cur = league.draft ? league.draft.picks[league.draft.index] : undefined;
  const round = cur?.round ?? 1;
  let tough = 0;
  const commit = p.prospect?.commit ?? 0;
  if (!p.prospect?.college && commit > 0.75) {
    if (round > POOL_ROUNDS) {
      // Day 3: an unsigned late pick costs nothing, so clubs take flyers on
      // talented kids headed to school and hope to buy them out with savings.
      tough = 0.5 - seededNormal(p.scoutSeed, orgId, 777) * 0.8;
    } else {
      // Rounds 1-10: the stronger the commitment, the further he falls.
      tough = (round >= 3 ? 2.5 : 1.5) + (round >= 3 ? 16 * (commit - 0.75) : 0);
      const pool = league.draft?.pools[orgId] ?? 0;
      if (cur && pool > 0 && cur.slot * 0.4 > pool * 0.08) tough += 3; // a big overslot would eat the pool
    }
  }
  // A sensible club knows how shaky its read is and pulls it toward a typical
  // prospect (more for high schoolers): no chasing a mirage at the top of the board.
  const shrink = 64 / (64 + sd * sd);
  const potRead = 50 + shrink * (potOvr(p) + noise - 50);
  const curRead = ovr(p) + noise * 0.4 * shrink;
  return draftTalent(p, potRead, curRead) - tough;
}

// Order teams worst to best by last season (or by roster strength for a brand-new league).
function baseOrder(league: League): number[] {
  const st = league.standings.MLB;
  const games = Object.values(st).reduce((t, r) => t + r.w + r.l, 0);
  if (games > 0 && league.lastStandings) return [...league.lastStandings];
  const strength = (id: number) => Object.values(league.players).filter((p) => p.orgId === id && p.level === 'MLB').reduce((t, p) => t + ovr(p), 0);
  return league.orgs.map((o) => o.id).sort((a, b) => strength(a) - strength(b) + (rand() - 0.5) * 30);
}

// Where the user's first-round pick should land, before the draft order is set:
// last season's standings, worst first (the top six go by lottery among clubs
// that missed the playoffs). Null in a league's first season.
export function projectedPick(league: League, orgId: number): { pick: number; lottery: boolean; drawn?: { season: number; lottery: DraftState['lottery'] } } | null {
  // December's lottery already set the order for the next draft.
  const next = league.phase === 'offseason' ? league.season + 1 : league.season;
  const dl = league.draftLottery;
  if (dl && dl.season === next) return { pick: firstRoundPick(league, dl.round1, dl.season, orgId) ?? 0, lottery: false, drawn: { season: dl.season, lottery: dl.lottery } };
  if (!league.lastStandings?.length) return null;
  const pick = league.lastStandings.indexOf(orgId) + 1;
  if (pick <= 0) return null;
  const playoff = new Set(league.lastPlayoffTeams ?? league.lastStandings.slice(-12));
  return { pick, lottery: !playoff.has(orgId) };
}

// The lottery for the top six picks among clubs that missed the playoffs
// (worst record = best odds). Held in December at the Winter Meetings; the
// result sets next summer's first-round order.
function drawLottery(league: League): { round1: number[]; lottery: DraftState['lottery'] } {
  const order = baseOrder(league); // worst first
  const playoff = new Set(league.lastPlayoffTeams ?? order.slice(-12));
  const nonPlayoff = order.filter((id) => !playoff.has(id));
  const lotteryTeams = nonPlayoff.slice(0, LOTTERY_ODDS.length);
  const odds = LOTTERY_ODDS.slice(0, lotteryTeams.length);
  const winners: number[] = [];
  const lottery: DraftState['lottery'] = [];
  for (let k = 0; k < Math.min(6, lotteryTeams.length); k++) {
    const pool = lotteryTeams.filter((t) => !winners.includes(t));
    const w = pool.map((t) => odds[lotteryTeams.indexOf(t)]);
    let r = rand() * w.reduce((a, b) => a + b, 0);
    let pick = pool[0];
    for (let i = 0; i < pool.length; i++) {
      r -= w[i];
      if (r <= 0) {
        pick = pool[i];
        break;
      }
    }
    winners.push(pick);
    lottery.push({ orgId: pick, pick: k + 1, from: nonPlayoff.indexOf(pick) + 1 });
  }
  return { round1: [...winners, ...nonPlayoff.filter((t) => !winners.includes(t)), ...order.filter((t) => playoff.has(t))], lottery };
}

// Clubs that already lost next summer's first-round pick (over the bonus pool).
function r1Forfeits(league: League, season: number): Set<number> {
  const adj = normalizeAdjust(league.draftAdjust);
  return new Set([...adj.forfeit.filter((f) => f.round === 1).map((f) => f.orgId), ...(league.futureForfeits ?? []).filter((f) => f.season === season && f.round === 1).map((f) => f.orgId)]);
}
// A club's first-round pick number once forfeited picks drop out.
export function firstRoundPick(league: League, round1: number[], season: number, orgId: number): number | null {
  const gone = r1Forfeits(league, season);
  if (gone.has(orgId)) return null;
  return round1.filter((id) => !gone.has(id)).indexOf(orgId) + 1 || null;
}

// Run in the offseason: draws next summer's lottery and tells the user.
export function runDraftLottery(league: League): void {
  const drawn = drawLottery(league);
  const season = league.season + 1;
  league.draftLottery = { season, ...drawn };
  const gone = r1Forfeits(league, season);
  const u = league.userOrgId;
  const odds = (orgId: number) => {
    const order = baseOrder(league);
    const playoff = new Set(league.lastPlayoffTeams ?? order.slice(-12));
    const i = order.filter((id) => !playoff.has(id)).indexOf(orgId);
    return i >= 0 && i < LOTTERY_ODDS.length ? LOTTERY_ODDS[i] : 0;
  };
  const name = (id: number) => league.orgs[id].affiliates.MLB.name;
  const ord = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][n % 10 > 3 || [11, 12, 13].includes(n % 100) ? 0 : n % 10]}`;
  const top = drawn.lottery.map((l) => `#${l.pick} ${name(l.orgId)}${l.from !== l.pick ? ` (${l.from === 1 ? 'worst' : `${ord(l.from)} worst`} record)` : ''}${gone.has(l.orgId) ? ' (pick forfeited: went over last year\'s bonus pool)' : ''}`);
  const mine = firstRoundPick(league, drawn.round1, season, u);
  const won = drawn.lottery.find((l) => l.orgId === u);
  const myOdds = odds(u);
  addNews(league, null, `Draft lottery: the ${name(drawn.lottery[0].orgId)} won the first pick in the ${league.season + 1} draft.`);
  addInbox(league, {
    from: 'Front office', kind: 'info', pids: [], stop: true, link: { page: 'draft' },
    subject: mine === null ? 'Draft lottery results (your first-round pick is forfeited)' : won && won.from > won.pick ? `Draft lottery: you moved up to #${mine}` : `Draft lottery results: you pick #${mine}`,
    text: `The ${season} draft lottery is in: ${top.join(', ')}.${myOdds ? ` You had a ${myOdds}% chance at the first pick.` : ' You were not in the lottery (playoff club).'} ${mine === null ? 'You forfeited your first-round pick for going over last year\'s bonus pool.' : `Your first-round pick is #${mine}.`} Picks after the lottery follow the standings, worst first; clubs far over the tax threshold drop 10 spots when the order is set on draft day.`,
  });
}

export function createDraft(league: League): DraftState {
  // Use December's lottery if there was one; otherwise (a league's first season) draw it now.
  const drawn = league.draftLottery?.season === league.season ? league.draftLottery : drawLottery(league);
  const lottery = drawn.lottery;
  let round1 = [...drawn.round1];
  // Clubs $40M+ over the tax threshold last season drop their first-round pick 10 spots (top 6 exempt).
  for (const orgId of [...round1]) {
    const idx = round1.indexOf(orgId);
    if (idx < 6 || cbtOverLastSeason(league, orgId) < 40e6) continue;
    round1.splice(idx, 1);
    round1.splice(Math.min(round1.length, idx + 10), 0, orgId);
    addNews(league, orgId, `The ${league.orgs[orgId].affiliates.MLB.name}' first-round pick moved back 10 spots for exceeding the tax threshold by $40M+.`);
  }
  round1 = [...round1];
  const picks: DraftPick[] = [];
  const adj = normalizeAdjust(league.draftAdjust);
  for (const f of (league.futureForfeits ?? []).filter((x) => x.season === league.season)) adj.forfeit.push({ orgId: f.orgId, round: f.round });
  league.futureForfeits = (league.futureForfeits ?? []).filter((x) => x.season > league.season);
  const forfeits = (orgId: number, round: number) => adj.forfeit.some((f) => f.orgId === orgId && f.round === round);
  const byOrder = (ids: number[]) => [...ids].sort((a, b) => round1.indexOf(a) - round1.indexOf(b));
  let overall = 1;
  const push = (orgId: number, round: number, label?: string) => {
    picks.push({ round, pick: overall, orgId, slot: slotValue(overall, round), pid: null, signed: null, label });
    overall++;
  };
  const cb = league.cbPicks.filter((c) => c.season === league.season);
  for (let round = 1; round <= league.settings.draftRounds; round++) {
    // Compensation for last year's unsigned 1st/2nd rounders: the pick right after the original slot.
    const comps = (adj.unsigned ?? []).filter((c) => c.round === round).sort((a, b) => a.pos - b.pos);
    let k = 0;
    round1.forEach((orgId, idx) => {
      if (!forfeits(orgId, round)) push(orgId, round);
      while (k < comps.length && comps[k].pos <= idx) push(comps[k++].orgId, round, 'Comp (unsigned)');
    });
    while (k < comps.length) push(comps[k++].orgId, round, 'Comp (unsigned)');
    if (round === 1) {
      for (const c of byOrder(adj.comp.filter((c) => c.after === 'R1').map((c) => c.orgId))) push(c, 1, 'Comp');
      for (const c of [...cb.filter((x) => x.round === 'A')].sort((a, b) => round1.indexOf(a.originalOrg) - round1.indexOf(b.originalOrg))) push(c.orgId, 1, 'CB-A');
    }
    if (round === 2) {
      for (const c of [...cb.filter((x) => x.round === 'B')].sort((a, b) => round1.indexOf(a.originalOrg) - round1.indexOf(b.originalOrg))) push(c.orgId, 2, 'CB-B');
      for (const c of byOrder(adj.comp.filter((c) => c.after === 'CBB').map((c) => c.orgId))) push(c, 2, 'Comp');
    }
    if (round === 4) for (const c of byOrder(adj.comp.filter((c) => c.after === 'R4').map((c) => c.orgId))) push(c, 4, 'Comp');
  }
  const pools: Record<number, number> = {};
  for (const o of league.orgs) pools[o.id] = 0;
  for (const p of picks) if (p.round <= POOL_ROUNDS) pools[p.orgId] += p.slot;
  league.draftAdjust = { comp: [], forfeit: [], unsigned: [] };
  for (const c of cb) c.orgId = -1; // used
  league.cbPicks = league.cbPicks.filter((c) => c.season !== league.season);
  const st: DraftState = { season: league.season, picks, index: 0, done: false, deadline: league.day + league.settings.draftSigningDays, pools, lottery };
  const l1 = lottery[0];
  if (l1) addNews(league, null, `Draft lottery: the ${league.orgs[l1.orgId].affiliates.MLB.name} won the #1 pick (from the #${l1.from} spot).`);
  return st;
}

export function availableProspects(league: League): Player[] {
  return Object.values(league.players).filter((p) => isProspect(p, league.season) && p.prospect!.orgId === undefined);
}

export function makePick(league: League, pick: DraftPick, p: Player): void {
  pick.pid = p.id;
  const info = p.prospect!;
  info.orgId = pick.orgId;
  info.round = pick.round;
  info.pick = pick.pick;
  info.slot = pick.slot;
  setDemand(league, pick, p);
  addTransaction(league, pick.orgId, 'Draft', `Drafted ${p.pos} ${pname(p)} (${info.college ? 'college' : 'high school'}) with pick #${pick.pick}, round ${pick.round}`, [p.id]);
}

function aiPick(league: League, orgId: number): Player | null {
  const avail = availableProspects(league);
  if (!avail.length) return null;
  let best: Player | null = null;
  let bv = -Infinity;
  for (const p of avail) {
    const v = draftValue(league, orgId, p);
    if (v > bv) {
      bv = v;
      best = p;
    }
  }
  return best;
}

export function onTheClock(league: League): DraftPick | null {
  const d = league.draft;
  if (!d || d.done) return null;
  return d.picks[d.index] ?? null;
}

// Makes picks until it is the user's turn (and the user drafts for himself),
// or the draft ends. Returns true when the user is on the clock.
export function advanceDraft(league: League, autoUser = false): boolean {
  const d = league.draft!;
  const user = league.orgs[league.userOrgId];
  while (d.index < d.picks.length) {
    const pk = d.picks[d.index];
    if (pk.orgId === league.userOrgId && !autoUser && !delegated(league, user, 'draft')) return true;
    const p = aiPick(league, pk.orgId);
    if (!p) break;
    makePick(league, pk, p);
    d.index++;
  }
  finishDraft(league);
  return false;
}

// Makes just the next pick (an AI club's), for following the draft pick by pick.
export function advanceOnePick(league: League): void {
  const d = league.draft;
  if (!d || d.done) return;
  const pk = d.picks[d.index];
  if (!pk || pk.orgId === league.userOrgId) return;
  const p = aiPick(league, pk.orgId);
  if (p) { makePick(league, pk, p); d.index++; }
  if (d.index >= d.picks.length) finishDraft(league);
}

// The assistant GM makes just the user's current pick.
export function userAutoPick(league: League): void {
  const pk = onTheClock(league);
  if (!pk || pk.orgId !== league.userOrgId) return;
  const p = aiPick(league, pk.orgId);
  if (!p) return;
  makePick(league, pk, p);
  league.draft!.index++;
}

export function userPick(league: League, p: Player): string | null {
  const pk = onTheClock(league);
  if (!pk || pk.orgId !== league.userOrgId) return 'You are not on the clock';
  if (!isProspect(p, league.season) || p.prospect!.orgId !== undefined) return 'Not available';
  makePick(league, pk, p);
  league.draft!.index++;
  return null;
}

function finishDraft(league: League): void {
  const d = league.draft!;
  if (d.done) return;
  d.done = true;
  addNews(league, null, `The ${league.season} draft is complete. Picks have until the signing deadline to sign.`);
  // Negotiations start right away.
  draftSigningDay(league);
}

export function poolSpent(league: League, orgId: number): number {
  const d = league.draft;
  if (!d) return 0;
  let t = 0;
  for (const pk of d.picks) {
    if (pk.orgId !== orgId || !pk.signed || pk.pid === null) continue;
    const bonus = pk.bonus ?? league.players[pk.pid]?.contract.bonus ?? 0;
    t += pk.round <= POOL_ROUNDS ? bonus : Math.max(0, bonus - LATE_ROUND_FREE);
  }
  return t;
}

// Unsigned top-10-round picks free up their slot value from the pool.
export function poolTotal(league: League, orgId: number): number {
  const d = league.draft;
  if (!d) return 0;
  let t = d.pools[orgId] ?? 0;
  for (const pk of d.picks) if (pk.orgId === orgId && pk.round <= POOL_ROUNDS && pk.signed === false) t -= pk.slot;
  return t;
}

export function canSign(_league: League, pk: DraftPick): string | null {
  if (pk.pid === null) return 'No player';
  if (pk.signed) return 'Already signed';
  if (pk.signed === false) return 'Did not sign';
  return null;
}

// Pool overage penalties (MLB): 0-5% over: 75% tax; 5-10%: 75% tax and next
// year's 1st-rounder; 10-15%: 100% tax and next year's 1st and 2nd; 15%+:
// 100% tax and 1st-rounders in each of the next two drafts.
export function overageTier(over: number, pool: number): { tax: number; text: string } {
  if (over <= 0 || pool <= 0) return { tax: 0, text: '' };
  const r = over / pool;
  if (r <= 0.05) return { tax: 0.75, text: '75% tax on the overage' };
  if (r <= 0.1) return { tax: 0.75, text: "75% tax and next year's 1st-round pick" };
  if (r <= 0.15) return { tax: 1, text: "100% tax and next year's 1st- and 2nd-round picks" };
  return { tax: 1, text: '100% tax and 1st-round picks in the next two drafts' };
}

export function signPick(league: League, pk: DraftPick, p: Player, ai = false, amount?: number): string | null {
  if (!ai) {
    const why = canSign(league, pk);
    if (why) return why;
  }
  const info = p.prospect!;
  const bonus = amount ?? info.asking ?? pk.slot;
  pk.signed = true;
  pk.bonus = bonus;
  p.orgId = pk.orgId;
  touchRosters();
  p.teamSince = league.season;
  p.level = info.college ? 'A' : 'CPX';
  p.draft = { year: league.season, round: pk.round, pick: pk.pick, orgId: pk.orgId };
  p.signAge = league.season - p.born;
  p.proSeasons = 0;
  milbContract(p, league.season, p.level);
  p.contract.bonus = bonus;
  delete p.prospect;
  addTransaction(league, pk.orgId, 'Sign', `Signed draft pick ${pname(p)} (#${pk.pick}) for a $${(bonus / 1e6).toFixed(2)}M bonus, assigned to ${league.orgs[pk.orgId].affiliates[p.level].name}`, [p.id]);
  logMove(league, 'Draft', [side(pk.orgId, [p.id])], `${league.orgs[pk.orgId].abbrev} signed #${pk.pick} pick (round ${pk.round}${pk.label ? `, ${pk.label}` : ''}) ${p.pos} ${pname(p)}`, bonus);
  return null;
}

export function autoSignUser(league: League): void {
  draftSigningDay(league);
}

// Signing deadline: unsigned picks go back to school (and their clubs get a
// compensation pick next year for 1st and 2nd rounders); pool overages are penalized.
export function draftDeadline(league: League): void {
  const d = league.draft;
  if (!d) return;
  const adj = normalizeAdjust(league.draftAdjust);
  for (const pk of d.picks) {
    if (pk.pid === null || pk.signed !== null) continue;
    pk.signed = false;
    const p = league.players[pk.pid];
    if (!p) continue;
    if (pk.round <= 2 && !pk.label) {
      const inRound = d.picks.filter((x) => x.round === pk.round && !x.label);
      adj.unsigned!.push({ orgId: pk.orgId, round: pk.round, pos: inRound.indexOf(pk) });
    }
    if (p.prospect) {
      const cls = p.prospect.cls ?? (p.prospect.college ? 'JR' : 'HS');
      if (cls === 'HS') p.prospect = { year: league.season + 3, college: true, cls: 'JR' };
      else if (cls === 'JR') p.prospect = { year: league.season + 1, college: true, cls: 'SR' };
      else delete league.players[p.id];
    }
    if (pk.orgId === league.userOrgId) {
      addNews(league, pk.orgId, `${pname(p)} (round ${pk.round}) did not sign before the deadline${pk.round <= 2 ? '; you get a compensation pick next year' : ''}.`, [p.id]);
    }
  }
  // Pool overage penalties.
  for (const org of league.orgs) {
    const pool = poolTotal(league, org.id);
    const over = poolSpent(league, org.id) - pool;
    if (over <= 0) continue;
    const tier = overageTier(over, pool);
    const r = over / pool;
    if (r > 0.05) adj.forfeit.push({ orgId: org.id, round: 1 });
    if (r > 0.1 && r <= 0.15) adj.forfeit.push({ orgId: org.id, round: 2 });
    if (r > 0.15) (league.futureForfeits ??= []).push({ season: league.season + 2, orgId: org.id, round: 1 });
    (league.draftTax ??= []).push({ season: league.season, orgId: org.id, over, tax: over * tier.tax, penalty: tier.text });
    addNews(league, org.id, `The ${org.affiliates.MLB.name} exceeded their draft bonus pool by ${(over / 1e6).toFixed(2)}M (${(r * 100).toFixed(1)}%): ${tier.text}.`);
  }
  league.draftAdjust = adj;
  // Undrafted prospects either return next year (college) or leave the pool.
  for (const p of Object.values(league.players)) {
    if (!p.prospect || p.orgId !== null || p.prospect.year !== league.season) continue;
    const age = league.season - p.born;
    if (age <= 21 && rand() < 0.5) p.prospect = { year: league.season + 1, college: true, ...amateurProfile(age + 1, true) };
    else delete league.players[p.id];
  }
  addNews(league, null, 'The draft signing deadline has passed.');
}

export function shuffleTies<T>(a: T[]): T[] {
  return shuffle(a);
}
