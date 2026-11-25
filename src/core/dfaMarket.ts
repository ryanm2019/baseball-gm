// What happens around a DFA, like real life:
//  - A club that genuinely wants a player you've designated (and doesn't want
//    to gamble on the waiver order) may call with a small trade: cash or a
//    low-level prospect. Not every DFA, only when someone is truly interested.
//  - Your assistant GM watches the waiver wire and flags players who fill one
//    of your needs. He never claims anyone himself.
import type { InboxMsg, League, Player } from './types.ts';
import { addInbox } from './morale.ts';
import { claimInterest, claimWorth, designate, fortyCut, posLabel } from './rules.ts';
import { emptyAssets, executeTrade, playerTradeBlock, tradeWindowOpen } from './trade.ts';
import { fmtMoney, roundSalary } from './contracts.ts';
import { ovr, potOvr } from './ratings.ts';
import { fortyMan, orgPlayers, pname } from './util.ts';
import { rand } from './random.ts';
import { teamNeeds } from './market.ts';
import { delegated } from './staff.ts';
import { dayShort } from './settings.ts';

// A spare piece an AI club would part with: a low-ceiling minor leaguer off the 40-man.
function spareProspect(league: League, orgId: number): Player | null {
  const pool = orgPlayers(league, orgId).filter((q) => !q.on40 && !q.il && !q.injury && q.level && ['A', 'A+', 'CPX', 'DSL'].includes(q.level) && potOvr(q) <= 45 && league.season - q.born >= 19 && !playerTradeBlock(league, q));
  return pool.length ? pool[Math.floor(rand() * pool.length)] : null;
}

export function dfaOffersDay(league: League): string | null {
  if (tradeWindowOpen(league)) return null;
  const user = league.userOrgId;
  for (const p of orgPlayers(league, user)) {
    if (!p.dfa || p.dfa.offered || league.day <= p.dfa.day) continue;
    // One look per DFA, a day or two in.
    if (league.day - p.dfa.day < 1 || rand() > 0.5) continue;
    p.dfa.offered = true;
    const keen = league.orgs.filter((o) => o.id !== user && claimInterest(league, o.id, p));
    if (!keen.length) continue;
    // Real interest, and only some of the time: the better he is, the likelier.
    const edge = claimWorth(league, p) - 45;
    if (rand() > Math.min(0.75, 0.25 + 0.05 * Math.max(0, edge))) continue;
    const org = keen[Math.floor(rand() * keen.length)];
    const prospect = rand() < 0.5 ? spareProspect(league, org.id) : null;
    const cash = prospect ? 0 : roundSalary(Math.min(500e3, Math.max(100e3, 100e3 + 40e3 * Math.max(0, edge))));
    const what = prospect ? `${posLabel(prospect)} ${pname(prospect)} (${prospect.level}, age ${league.season - prospect.born})` : `${fmtMoney(cash)} in cash`;
    addInbox(league, {
      from: `${org.affiliates.MLB.name} front office`,
      subject: `Trade interest in ${pname(p)} (${org.abbrev})`,
      kind: 'dfa-offer',
      pids: prospect ? [p.id, prospect.id] : [p.id],
      dfaDeal: { orgId: org.id, pid: p.id, cash, prospect: prospect?.id ?? null },
      stop: true,
      text: `The ${org.affiliates.MLB.name} would rather not wait on waivers for ${posLabel(p)} ${pname(p)}, whom you designated for assignment. They'll send ${what} for him. The offer stands until his DFA period ends; otherwise he goes on waivers, where anyone can claim him (or he clears).`,
      actions: [{ key: 'accept', label: `Accept: ${prospect ? pname(prospect) : fmtMoney(cash)}` }, { key: 'decline', label: 'Decline (take him to waivers)' }],
    });
    return `Inbox: the ${org.affiliates.MLB.name} want to trade for ${pname(p)}.`;
  }
  return null;
}

export function answerDfaOffer(league: League, msg: InboxMsg, key: string): string {
  const d = msg.dfaDeal;
  msg.read = true;
  if (!d) return '';
  const p = league.players[d.pid];
  if (key !== 'accept') { msg.resolved = 'Declined'; return `You passed. ${p ? pname(p) : 'He'} stays in DFA limbo until he goes on waivers.`; }
  if (!p || p.orgId !== league.userOrgId || !p.dfa) { msg.resolved = 'Expired'; return 'Too late: he is no longer designated for assignment.'; }
  const closed = tradeWindowOpen(league);
  if (closed) { msg.resolved = 'Expired'; return `${closed}.`; }
  const pr = d.prospect !== null ? league.players[d.prospect] : null;
  if (d.prospect !== null && (!pr || pr.orgId !== d.orgId)) { msg.resolved = 'Expired'; return 'That prospect is no longer available; the offer is off.'; }
  // They make room on their 40-man first.
  if (fortyMan(league, d.orgId).length >= league.settings.fortyMax) {
    const cut = fortyCut(league, d.orgId);
    if (cut) designate(league, cut);
  }
  const give = emptyAssets();
  give.pids = [p.id];
  const get = emptyAssets();
  if (pr) get.pids = [pr.id];
  get.cash = d.cash;
  const err = executeTrade(league, { orgs: [league.userOrgId, d.orgId], give: [give, get] });
  if (err) { msg.resolved = 'Fell through'; return `The deal fell through: ${err}`; }
  p.on40 = true;
  p.dfa = null;
  if (!p.level) p.level = 'AAA';
  msg.resolved = 'Accepted';
  return `Done: ${pname(p)} to the ${league.orgs[d.orgId].affiliates.MLB.name} for ${pr ? pname(pr) : fmtMoney(d.cash)}.`;
}

// Your assistant GM's waiver report: players who'd fill one of your needs.
export function waiverFlags(league: League): string | null {
  const userOrg = league.orgs[league.userOrgId];
  if (!delegated(league, userOrg, 'waivers')) return null;
  const needs = teamNeeds(league, userOrg.id);
  const flagged: Player[] = [];
  for (const p of Object.values(league.players)) {
    const w = p.waivers;
    if (!w || w.flagged || w.fromOrg === userOrg.id) continue;
    w.flagged = true;
    if (!needs.includes(p.pos)) continue;
    // Worth it: better than what you have there now (or a real prospect).
    const mine = orgPlayers(league, userOrg.id).filter((q) => q.pos === p.pos && (q.level === 'MLB' || q.on40)).map(ovr).sort((a, b) => b - a);
    const bar = p.pos === 'SP' ? mine[4] : p.pos === 'RP' ? mine[5] : mine[0];
    if (ovr(p) >= (bar ?? 0) + 1 || (league.season - p.born <= 24 && potOvr(p) >= 55)) flagged.push(p);
  }
  if (!flagged.length) return null;
  const until = dayShort(league.season, league.day + league.settings.waiverDays);
  addInbox(league, {
    from: 'Assistant GM',
    subject: flagged.length === 1 ? `Waiver wire: ${pname(flagged[0])} fits a need` : `Waiver wire: ${flagged.length} players who fit our needs`,
    kind: 'info',
    pids: flagged.map((p) => p.id),
    stop: true,
    link: { page: 'waivers' },
    text: `${flagged.map((p) => `${posLabel(p)} ${pname(p)} (from the ${league.orgs[p.waivers!.fromOrg].affiliates.MLB.name}${p.contract.type === 'ML' ? `, ${fmtMoney(p.contract.salary)}` : ''})`).join('; ')} ${flagged.length === 1 ? 'is' : 'are'} on waivers at a spot where we're thin (${needs.join(', ')}). Your call: put in a claim on the Waivers page by ${until}. I won't claim anyone without you.`,
  });
  return 'Inbox: your assistant GM flagged a waiver claim.';
}
