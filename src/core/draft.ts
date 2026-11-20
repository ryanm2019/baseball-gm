// The amateur draft, held at the All-Star break: draft class generation, the
// lottery for the top six picks, slot values and bonus pools, and signings.
import type { DraftPick, DraftState, League, Player } from './types.ts';
import { generatePlayer } from './playerGen.ts';
import { clamp, normal, rand, seededNormal, shuffle } from './random.ts';
import { ovr, potOvr } from './ratings.ts';
import { milbContract, roundSalary } from './contracts.ts';
import { addNews, addTransaction, pname, touchRosters } from './util.ts';
import { agmEvalSd, delegated, staffOf } from './staff.ts';

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
      talentShift: normal(-2, 2.5),
    });
    p.level = null;
    p.proSeasons = 0;
    p.prospect = { year: season, college };
    milbContract(p, season, 'A');
    league.players[p.id] = p;
  }
}

export const isProspect = (p: Player, season?: number) => !!p.prospect && p.orgId === null && (season === undefined || p.prospect.year === season);

function draftValue(league: League, orgId: number, p: Player): number {
  const org = league.orgs[orgId];
  const fd = staffOf(league, org, 'FD');
  const sd = orgId === league.userOrgId ? agmEvalSd(league, org) : fd ? Math.max(0, ((80 - fd.evaluation) / 60) * 5) : 5;
  const noise = sd * seededNormal(p.scoutSeed, orgId, 4242);
  return 0.72 * potOvr(p) + 0.28 * ovr(p) + noise - (p.prospect?.college ? 0 : 0.5);
}

// Order teams worst to best by last season (or by roster strength for a brand-new league).
function baseOrder(league: League): number[] {
  const st = league.standings.MLB;
  const games = Object.values(st).reduce((t, r) => t + r.w + r.l, 0);
  if (games > 0 && league.lastStandings) return [...league.lastStandings];
  const strength = (id: number) => Object.values(league.players).filter((p) => p.orgId === id && p.level === 'MLB').reduce((t, p) => t + ovr(p), 0);
  return league.orgs.map((o) => o.id).sort((a, b) => strength(a) - strength(b) + (rand() - 0.5) * 30);
}

export function createDraft(league: League): DraftState {
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
  const round1 = [...winners, ...nonPlayoff.filter((t) => !winners.includes(t)), ...order.filter((t) => playoff.has(t))];
  const picks: DraftPick[] = [];
  const adj = league.draftAdjust ?? { comp: [], forfeit: [] };
  let overall = 1;
  for (let round = 1; round <= league.settings.draftRounds; round++) {
    for (const orgId of round1) {
      if (round === 2 && adj.forfeit.includes(orgId)) continue;
      picks.push({ round, pick: overall, orgId, slot: slotValue(overall, round), pid: null, signed: null });
      overall++;
    }
    if (round === 2) {
      for (const orgId of adj.comp) {
        picks.push({ round: 2, pick: overall, orgId, slot: slotValue(overall, 2), pid: null, signed: null });
        overall++;
      }
    }
  }
  const pools: Record<number, number> = {};
  for (const o of league.orgs) pools[o.id] = 0;
  for (const p of picks) if (p.round <= POOL_ROUNDS) pools[p.orgId] += p.slot;
  league.draftAdjust = { comp: [], forfeit: [] };
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
  // HS players with college options and top talents ask for more.
  const leverage = info.college ? 1 : 1.12;
  info.asking = roundSalary(Math.max(pick.round > POOL_ROUNDS ? 25_000 : pick.slot * 0.75, pick.slot * clamp(normal(1.0, 0.12), 0.75, 1.35) * leverage));
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
  // AI clubs sign almost all of their picks right away.
  for (const pk of d.picks) {
    if (pk.pid === null || pk.orgId === league.userOrgId) continue;
    const p = league.players[pk.pid];
    const r = rand();
    if (pk.round <= POOL_ROUNDS ? r < 0.95 : r < 0.75) signPick(league, pk, p, true);
  }
  if (delegated(league, league.orgs[league.userOrgId], 'draft')) autoSignUser(league);
}

export function poolSpent(league: League, orgId: number): number {
  const d = league.draft;
  if (!d) return 0;
  let t = 0;
  for (const pk of d.picks) {
    if (pk.orgId !== orgId || !pk.signed || pk.pid === null) continue;
    const bonus = league.players[pk.pid].contract.bonus ?? 0;
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

export function canSign(league: League, pk: DraftPick): string | null {
  if (pk.pid === null) return 'No player';
  if (pk.signed) return 'Already signed';
  if (pk.signed === false) return 'Did not sign';
  const p = league.players[pk.pid];
  const ask = p.prospect?.asking ?? pk.slot;
  const extra = pk.round <= POOL_ROUNDS ? ask : Math.max(0, ask - LATE_ROUND_FREE);
  const limit = poolTotal(league, pk.orgId) * 1.05; // up to 5% over (taxed)
  if (poolSpent(league, pk.orgId) + extra > limit) return 'Would exceed your bonus pool by more than 5%';
  return null;
}

export function signPick(league: League, pk: DraftPick, p: Player, ai = false): string | null {
  if (!ai) {
    const why = canSign(league, pk);
    if (why) return why;
  }
  const info = p.prospect!;
  const bonus = info.asking ?? pk.slot;
  pk.signed = true;
  p.orgId = pk.orgId;
  touchRosters();
  p.level = info.college ? 'A' : 'CPX';
  p.draft = { year: league.season, round: pk.round, pick: pk.pick, orgId: pk.orgId };
  p.signAge = league.season - p.born;
  p.proSeasons = 0;
  milbContract(p, league.season, p.level);
  p.contract.bonus = bonus;
  delete p.prospect;
  addTransaction(league, pk.orgId, 'Sign', `Signed draft pick ${pname(p)} (#${pk.pick}) for a $${(bonus / 1e6).toFixed(2)}M bonus, assigned to ${league.orgs[pk.orgId].affiliates[p.level].name}`, [p.id]);
  return null;
}

export function autoSignUser(league: League): void {
  const d = league.draft;
  if (!d) return;
  const mine = d.picks.filter((pk) => pk.orgId === league.userOrgId && pk.pid !== null && pk.signed === null).sort((a, b) => a.pick - b.pick);
  for (const pk of mine) if (!canSign(league, pk)) signPick(league, pk, league.players[pk.pid!]);
}

// Signing deadline: unsigned picks go back into next year's pool.
export function draftDeadline(league: League): void {
  const d = league.draft;
  if (!d) return;
  for (const pk of d.picks) {
    if (pk.pid === null || pk.signed !== null) continue;
    pk.signed = false;
    const p = league.players[pk.pid];
    if (p.prospect) {
      const age = league.season - p.born;
      if (age <= 22) {
        p.prospect = { year: league.season + 1, college: true };
      } else {
        delete p.prospect;
      }
    }
    if (pk.orgId === league.userOrgId) addNews(league, pk.orgId, `${pname(p)} (round ${pk.round}) did not sign before the deadline.`, [p.id]);
  }
  // Undrafted prospects either return next year (college) or leave the pool.
  for (const p of Object.values(league.players)) {
    if (!p.prospect || p.orgId !== null || p.prospect.year !== league.season) continue;
    const age = league.season - p.born;
    if (age <= 21 && rand() < 0.5) p.prospect = { year: league.season + 1, college: true };
    else delete league.players[p.id];
  }
  addNews(league, null, 'The draft signing deadline has passed.');
}

export function shuffleTies<T>(a: T[]): T[] {
  return shuffle(a);
}
