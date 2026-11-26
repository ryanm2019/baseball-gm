// Successor contracts: before minor league free agency opens, a club can offer
// its own pending minor league free agents a new minor league deal. He answers
// within a day; familiarity and loyalty help, but he weighs it against what the
// open market would likely bring (level, camp invite, path to the majors).
import type { League, Level, Player } from './types.ts';
import { MINOR_LEVELS } from './types.ts';
import { MILB_SALARY } from './contracts.ts';
import { exclusiveFaDay, inExclusiveWindow, pendingFreeAgent } from './extensions.ts';
import { dayShort } from './settings.ts';
import { LEVEL_PULL, pathScore } from './milbFa.ts';
import { addInbox } from './morale.ts';
import { ovr, scoutedOvr } from './ratings.ts';
import { rand } from './random.ts';
import { posLabel } from './rules.ts';
import { delegated } from './staff.ts';
import { activeAt, addTransaction, orgPlayers, pname } from './util.ts';

// Six-plus pro seasons, off the 40-man, minor league deal ending this season.
export function pendingMilbFa(league: League, p: Player): boolean {
  return p.orgId !== null && !p.retired && p.contract.type !== 'ML' && p.contract.exp === league.season && p.proSeasons >= 6 && !p.on40;
}

export const marketLevel = (p: Player): Level => (ovr(p) >= 44 ? 'AAA' : ovr(p) >= 39 ? 'AA' : 'A+');

// Chance he takes your offer instead of testing the market.
export function successorOdds(league: League, p: Player, level: Level, invite: boolean): number {
  const age = league.season + 1 - p.born;
  const mult = ovr(p) >= 45 ? 1.3 : 1;
  const ours = (LEVEL_PULL[level] ?? 0) * mult + (invite ? (age >= 25 ? 1 : 0.4) : 0) + pathScore(league, p.orgId!, p);
  const market = (LEVEL_PULL[marketLevel(p)] ?? 0) * mult + (age >= 25 && ovr(p) >= 44 ? 0.75 : 0) + 1.2;
  const loyal = (p.personality.loyalty - 50) / 40;
  const x = (ours - market + 0.2 + loyal * 0.8) / 0.7; // +0.2: he knows the org
  return Math.max(0.05, Math.min(0.85, 1 / (1 + Math.exp(-x))));
}

export const oddsLabel = (x: number) => (x >= 0.65 ? 'Likely to accept' : x >= 0.4 ? 'Could go either way' : x >= 0.2 ? 'Leaning toward the market' : 'Likely to test the market');

export function canOfferSuccessor(league: League, p: Player, orgId = league.userOrgId): string | null {
  if (p.orgId !== orgId) return 'Not your player';
  if (!inExclusiveWindow(league)) return 'Successor contracts are offered between the end of the season and the opening of free agency';
  if (!pendingMilbFa(league, p)) return 'Only players about to become minor league free agents';
  const o = p.successor?.season === league.season ? p.successor : null;
  if (o?.answer === 'yes') return 'Already re-signed';
  if (o?.answer === 'no') return 'He turned down your offer: he wants to test the market';
  if (o) return 'Offer out: he answers tomorrow';
  return null;
}

export function offerSuccessor(league: League, p: Player, level: Level, invite: boolean, orgId = league.userOrgId, byAgm = false): string | null {
  const why = canOfferSuccessor(league, p, orgId);
  if (why) return why;
  if (!MINOR_LEVELS.includes(level)) return 'Minor league deals go to an affiliate';
  p.successor = { season: league.season, level, invite, day: league.day, byAgm };
  return null;
}

export function withdrawSuccessor(league: League, p: Player): void {
  if (p.successor?.season === league.season && !p.successor.answer) p.successor = null;
}

function decide(league: League, p: Player): void {
  const o = p.successor!;
  const yes = rand() < successorOdds(league, p, o.level, o.invite);
  o.answer = yes ? 'yes' : 'no';
  const from = o.byAgm ? 'Assistant GM' : 'Front office';
  const terms = `${o.level}${o.invite ? ', with an invite to big league camp' : ''}`;
  if (yes) {
    const c = p.contract;
    c.type = 'MiLB';
    c.exp = league.season + 1;
    c.salary = c.minorSalary = MILB_SALARY[o.level];
    c.signed = league.season;
    if (p.level !== o.level && activeAt(league, p.orgId!, o.level).length < league.settings.milbActiveMax[o.level]) p.level = o.level;
    addTransaction(league, p.orgId!, 'Sign', `Re-signed ${posLabel(p)} ${pname(p)} to a minor league contract (${terms})`, [p.id]);
    if (p.orgId === league.userOrgId) addInbox(league, { from, kind: 'info', pids: [p.id], subject: `${pname(p)} re-signed`, text: `${posLabel(p)} ${pname(p)} accepted the successor contract (${terms}) and won't become a free agent.` });
  } else if (p.orgId === league.userOrgId) {
    addInbox(league, { from, kind: 'info', pids: [p.id], subject: `${pname(p)} will test the market`, text: `${posLabel(p)} ${pname(p)} turned down the successor contract (${terms}). He'll be a minor league free agent when the market opens; you can still bid on him then.` });
  }
}

// Daily in the offseason: offers from yesterday or earlier get an answer.
// `all` settles every open offer (free agency is opening).
export function successorDay(league: League, all = false): void {
  for (const p of Object.values(league.players)) {
    const o = p.successor;
    if (!o || o.season !== league.season || o.answer || p.orgId === null) continue;
    if (!all && league.day <= o.day) continue;
    decide(league, p);
  }
  if (all || !inExclusiveWindow(league) || league.windowNote === league.season) return;
  league.windowNote = league.season;
  const mine = orgPlayers(league, league.userOrgId);
  const ml = mine.filter((p) => pendingFreeAgent(league, p)).length;
  const milb = mine.filter((p) => pendingMilbFa(league, p)).length;
  const agm = delegated(league, league.orgs[league.userOrgId], 'milbfa');
  if (ml || milb) addInbox(league, { from: 'Assistant GM', kind: 'info', pids: [], subject: 'Exclusive window: talk to our free agents', text: `Until free agency opens on ${dayShort(league.season, exclusiveFaDay(league))}, we're the only club that can talk to our own free agents${ml ? `: ${ml} major leaguer${ml === 1 ? '' : 's'} (most will want to test the market, but a strong offer can keep a loyal one)` : ''}${milb ? `${ml ? ', and' : ':'} ${milb} minor leaguer${milb === 1 ? '' : 's'} we can offer successor contracts` : ''}. It's all on the Free Agents page.${milb && agm ? ' I handle minor league signings, so I am making successor offers to the ones worth keeping.' : ''}` });
  if (agm) agmSuccessors(league);
}

// The assistant GM keeps the useful upper-level depth: players at Double-A or
// Triple-A who are still good enough for a spot there.
function agmSuccessors(league: League): void {
  const made: string[] = [];
  const mine = orgPlayers(league, league.userOrgId).filter((p) => pendingMilbFa(league, p) && (p.level === 'AAA' || p.level === 'AA') && league.season + 1 - p.born <= 33);
  mine.sort((a, b) => scoutedOvr(league, b) - scoutedOvr(league, a));
  for (const p of mine) {
    if (made.length >= 6) break;
    const so = scoutedOvr(league, p);
    if (so < (p.level === 'AAA' ? 42 : 39)) continue;
    const invite = league.season + 1 - p.born >= 25 && so >= 45;
    if (!offerSuccessor(league, p, p.level!, invite, league.userOrgId, true)) made.push(`${posLabel(p)} ${pname(p)} (${p.level}${invite ? ', camp invite' : ''})`);
  }
  if (made.length) addInbox(league, { from: 'Assistant GM', kind: 'info', pids: [], subject: `Successor offers to ${made.length} of our minor league free agents`, text: `Before they hit the market, I've offered new minor league deals to ${made.join('; ')}. They'll answer tomorrow.` });
}
