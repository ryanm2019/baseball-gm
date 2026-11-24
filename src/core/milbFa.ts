// Minor league free agency with a short bidding window: clubs offer a spot at
// an affiliate (and maybe an invite to big league camp), other clubs can bid,
// and after a few days the player picks the best fit for his career.
import type { League, Level, Org, Player } from './types.ts';
import { MINOR_LEVELS } from './types.ts';
import { isFreeAgent, isMinorFA } from './freeAgency.ts';
import { signFreeAgent } from './rules.ts';
import { isPitcher, ovr, scoutedOvr } from './ratings.ts';
import { activeAt, pname } from './util.ts';
import { addInbox } from './morale.ts';
import { delegated } from './staff.ts';
import { rand, randInt } from './random.ts';
import { posLabel } from './rules.ts';
import { dayShort } from './settings.ts';

export interface MilbOffer { orgId: number; level: Level; invite: boolean; day: number; byAgm?: boolean }

const LEVEL_PULL: Partial<Record<Level, number>> = { AAA: 3, AA: 2, 'A+': 1.2, A: 0.8, CPX: 0.4, DSL: 0.2 };

export const milbOffers = (p: Player): MilbOffer[] => (p.fa as { milbOffers?: MilbOffer[] } | null | undefined)?.milbOffers ?? [];
const setOffers = (p: Player, o: MilbOffer[]) => { (p.fa as { milbOffers?: MilbOffer[] }).milbOffers = o; };
export const milbDecideDay = (p: Player): number | undefined => (p.fa as { milbDecide?: number } | null | undefined)?.milbDecide;
export const isMilbBidding = (p: Player) => milbOffers(p).length > 0;

// How much a club's offer appeals to him: a higher level (more so for better
// players), a camp invite (for veterans), and a clear path to the majors (few
// big leaguers at his position who are better than him), plus some taste.
function appeal(league: League, p: Player, o: MilbOffer): number {
  const age = league.season - p.born;
  const lvl = (LEVEL_PULL[o.level] ?? 0) * (ovr(p) >= 45 ? 1.3 : 1);
  const invite = o.invite ? (age >= 25 ? 1.5 : 0.6) : 0;
  const blockers = activeAt(league, o.orgId, 'MLB').filter((q) => (isPitcher(p) ? q.pos === p.pos : q.pos === p.pos) && ovr(q) > ovr(p)).length;
  const path = Math.max(0, 2 - blockers * 0.5);
  return lvl + invite + path + rand() * 0.8;
}

export function offerMilb(league: League, orgId: number, p: Player, level: Level, invite: boolean, byAgm = false): string | null {
  if (!isFreeAgent(p) || !p.fa) return 'Not a free agent';
  if (!MINOR_LEVELS.includes(level)) return 'Minor league deals go to an affiliate';
  if (activeAt(league, orgId, level).length >= league.settings.milbActiveMax[level]) return `${level} roster is full`;
  const fa = p.fa as typeof p.fa & { milbDecide?: number };
  setOffers(p, [...milbOffers(p).filter((o) => o.orgId !== orgId), { orgId, level, invite, day: league.day, byAgm }]);
  // The window starts with the first offer: a few days in the winter, a day or two in season.
  fa.milbDecide ??= league.day + (league.phase === 'regular' ? randInt(1, 2) : randInt(1, 4));
  // Word gets around: a decent player draws other clubs' bids.
  if (orgId === league.userOrgId && !byAgm) rivalBids(league, p);
  else if (orgId === league.userOrgId && rand() < 0.5) rivalBids(league, p);
  return null;
}

export function withdrawMilb(p: Player, orgId: number): void {
  if (!p.fa) return;
  setOffers(p, milbOffers(p).filter((o) => o.orgId !== orgId));
  if (!milbOffers(p).length) delete (p.fa as { milbDecide?: number }).milbDecide;
}

function rivalBids(league: League, p: Player): void {
  const q = ovr(p) - 38;
  const n = q <= 0 ? (rand() < 0.15 ? 1 : 0) : Math.min(4, Math.floor(rand() * (1 + q * 0.35)));
  const others = league.orgs.filter((o) => o.id !== league.userOrgId && !milbOffers(p).some((x) => x.orgId === o.id));
  for (let i = 0; i < n && others.length; i++) {
    const org = others.splice(Math.floor(rand() * others.length), 1)[0];
    const level: Level = ovr(p) >= 44 ? 'AAA' : ovr(p) >= 39 ? 'AA' : 'A+';
    if (activeAt(league, org.id, level).length >= league.settings.milbActiveMax[level]) continue;
    setOffers(p, [...milbOffers(p), { orgId: org.id, level, invite: league.season - p.born >= 25 && ovr(p) >= 44 && rand() < 0.5, day: league.day }]);
  }
}

// Daily: players whose window is up choose; your assistant GM bids weekly if he
// runs minor league signings for you.
export function milbBidDay(league: League): void {
  for (const p of Object.values(league.players)) {
    const d = milbDecideDay(p);
    if (d === undefined || !isFreeAgent(p) || !p.fa || league.day < d) continue;
    const offers = milbOffers(p).filter((o) => activeAt(league, o.orgId, o.level).length < league.settings.milbActiveMax[o.level]);
    const userHad = milbOffers(p).find((o) => o.orgId === league.userOrgId);
    withdrawAll(p);
    if (!offers.length) continue;
    const best = offers.map((o) => ({ o, s: appeal(league, p, o) })).sort((a, b) => b.s - a.s)[0].o;
    signFreeAgent(league, p, best.orgId, best.level, false);
    const team = league.orgs[best.orgId].affiliates.MLB.name;
    if (best.orgId === league.userOrgId) {
      addInbox(league, { from: best.byAgm ? 'Assistant GM' : 'Front office', kind: 'info', pids: [p.id], stop: !best.byAgm, subject: `${pname(p)} signed a minor league deal with you`, text: `${posLabel(p)} ${pname(p)} ${offers.length > 1 ? `picked your offer over ${offers.length - 1} other${offers.length === 2 ? '' : 's'}` : 'took your offer (he had no others)'}: he reports to ${best.level}${best.invite ? ', with an invite to big league camp' : ''}.` });
    } else if (userHad) {
      addInbox(league, { from: userHad.byAgm ? 'Assistant GM' : 'Front office', kind: 'info', pids: [p.id], stop: !userHad.byAgm, subject: `${pname(p)} signed with the ${team}`, text: `${posLabel(p)} ${pname(p)} chose the ${team}'s minor league offer (${best.level}${best.invite ? ', big league camp invite' : ''}) over yours (${userHad.level}${userHad.invite ? ', camp invite' : ''}).` });
    }
  }
  const user = league.orgs[league.userOrgId];
  if (league.phase !== 'regular' && league.day % 7 === 3 && delegated(league, user, 'milbfa')) agmMilbBids(league, user);
}

function withdrawAll(p: Player): void {
  if (!p.fa) return;
  setOffers(p, []);
  delete (p.fa as { milbDecide?: number }).milbDecide;
}

// The assistant GM shores up Triple-A where it's thinnest: for each of your
// weakest spots, an offer to the best available player who'd be an upgrade.
function agmMilbBids(league: League, org: Org): void {
  const aaa = activeAt(league, org.id, 'AAA');
  if (aaa.length >= league.settings.milbActiveMax.AAA - 2) return;
  const spots = ['C', 'SS', '2B', '3B', 'CF', '1B', 'LF', 'RF', 'SP', 'RP'] as const;
  const bestAt = (pos: string) => Math.max(0, ...aaa.filter((p) => p.pos === pos).map((p) => scoutedOvr(league, p)));
  const thin = [...spots].sort((a, b) => bestAt(a) - bestAt(b)).slice(0, 3);
  const made: string[] = [];
  for (const pos of thin) {
    if (made.length >= 2) break;
    const cand = Object.values(league.players)
      .filter((p) => isFreeAgent(p) && p.fa && isMinorFA(league, p) && p.pos === pos && !milbOffers(p).some((o) => o.orgId === org.id) && scoutedOvr(league, p) > bestAt(pos) + 2 && league.season - p.born <= 34)
      .sort((a, b) => scoutedOvr(league, b) - scoutedOvr(league, a))[0];
    if (!cand) continue;
    const invite = league.season - cand.born >= 25 && scoutedOvr(league, cand) >= 45;
    if (!offerMilb(league, org.id, cand, 'AAA', invite, true)) made.push(`${posLabel(cand)} ${pname(cand)} (AAA${invite ? ', camp invite' : ''}, decides ${dayShort(league.season, milbDecideDay(cand)!)})`);
  }
  if (made.length) addInbox(league, { from: 'Assistant GM', kind: 'info', pids: [], subject: `Minor league offers out to ${made.length} player${made.length === 1 ? '' : 's'}`, text: `To shore up Triple-A where we're thin, I've made minor league offers to ${made.join('; ')}. You'll hear when they decide.` });
}
