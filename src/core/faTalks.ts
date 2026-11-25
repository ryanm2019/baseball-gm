// Free agent negotiation with you, as an ongoing conversation with his agent:
//  - Every offer you make gets an answer in a day or three: he takes it, he
//    counters with what it would take, or he tells you you're not close.
//  - When another club tops your offer, his agent lets you know (roughly by
//    how much and what you'd need), at most once every few days.
// AI clubs' offers carry full terms too (options, opt-outs, no-trade clauses,
// deferrals); he weighs every offer by what it's worth to him.
import type { FaOffer, InboxMsg, League, Player } from './types.ts';
import { addInbox } from './morale.ts';
import { closeWithUser, offerScore } from './freeAgency.ts';
import { fmtMoney, roundSalary } from './contracts.ts';
import { buildContract, cbtAav, describeContract, type Terms } from './terms.ts';
import { pname } from './util.ts';
import { posLabel } from './rules.ts';
import { rand, randInt } from './random.ts';
import { dayShort } from './settings.ts';

const agentFrom = (p: Player) => `Agent for ${pname(p)}`;
const deal = (o: FaOffer) => `${o.years === 1 ? '1 year' : `${o.years} years`} at ${fmtMoney(o.aav)} a year`;

// The same offer scaled up or down in money (years and clauses kept).
function scaled(o: FaOffer, k: number): FaOffer {
  const terms: Terms | undefined = o.terms ? { ...o.terms, sched: o.terms.sched.map((x) => roundSalary(x * k)) } : undefined;
  return { ...o, aav: roundSalary(terms ? cbtAav(terms) : o.aav * k), terms };
}

// What it would take: the smallest raise that gets this offer to a target score.
export function whatItTakes(league: League, p: Player, o: FaOffer, target: number): FaOffer {
  if (offerScore(league, p, o) >= target) return o;
  let lo = 1, hi = 1.05;
  while (offerScore(league, p, scaled(o, hi)) < target && hi < 4) hi *= 1.15;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (offerScore(league, p, scaled(o, mid)) >= target) hi = mid;
    else lo = mid;
  }
  return { ...scaled(o, hi), day: league.day };
}

const bestRival = (league: League, p: Player): { o: FaOffer; s: number } | null => {
  let best: { o: FaOffer; s: number } | null = null;
  for (const o of p.fa!.offers) {
    if (o.orgId === league.userOrgId) continue;
    const s = offerScore(league, p, o);
    if (!best || s > best.s) best = { o, s };
  }
  return best;
};

// You made (or changed) an offer: his agent answers soon.
export function offerMade(league: League, p: Player): void {
  if (!p.fa) return;
  const notable = p.fa.asking.aav > 8e6;
  p.fa.talk = { respondDay: league.day + randInt(1, notable ? 3 : 2), noted: p.fa.talk?.noted };
}

// Daily: answers that are due.
export function agentReplies(league: League): void {
  for (const p of Object.values(league.players)) {
    const fa = p.fa;
    if (!fa || fa.pending || !fa.talk || p.orgId !== null || league.day < fa.talk.respondDay || fa.talk.respondDay < 0) continue;
    const mine = fa.offers.find((o) => o.orgId === league.userOrgId);
    if (!mine) { fa.talk = undefined; continue; }
    fa.talk.respondDay = -1; // answered
    const s = offerScore(league, p, mine);
    const rival = bestRival(league, p);
    const r = rival?.s ?? 0;
    const notable = fa.asking.aav > 8e6;
    const rivalLine = rival && r > s ? ` Another club has offered more (their deal is worth about ${Math.round((r / Math.max(0.01, s) - 1) * 100)}% more to him).` : rival ? ` You're ahead of the ${fa.offers.length - 1 === 1 ? 'other offer' : `${fa.offers.length - 1} other offers`} right now.` : ' Nobody else has made an offer yet.';
    // He takes it: clearly the best deal and at or above his number (bigger names take a little longer).
    if (s >= 1.0 && s >= r + 0.04 && rand() < (notable ? 0.55 : 0.85)) {
      const how = closeWithUser(league, p, mine);
      if (how === 'signed') return; // signFreeAgentOffer sends the "signed with you" note
      continue;
    }
    if (s >= 0.8) {
      // A counter: what it would take to be his choice.
      const target = Math.max(1.02, r + 0.05);
      const c = whatItTakes(league, p, mine, target);
      fa.talk.counter = c;
      addInbox(league, {
        from: agentFrom(p), subject: `${pname(p)} counters: ${deal(c)}`, kind: 'fa-reply', pids: [p.id], faPid: p.id, stop: true,
        link: { page: 'negotiate', args: ['fa', p.id] },
        text: `We appreciate the offer (${deal(mine)}${mine.terms ? `; ${describeContract(league, buildContract(mine.terms, league.season + 1, league.season))}` : ''}).${rivalLine} For ${p.first} to sign today it would take ${deal(c)} (${fmtMoney(c.aav * c.years)} total), same structure. He decides by ${dayShort(league.season, fa.decideDay)} either way.`,
        actions: [{ key: 'accept', label: `Accept: ${deal(c)}` }, { key: 'revise', label: 'Revise my offer' }, { key: 'pass', label: 'Hold firm' }],
      });
      continue;
    }
    const need = whatItTakes(league, p, mine, Math.max(1.0, r + 0.02));
    addInbox(league, {
      from: agentFrom(p), subject: `${pname(p)}: not close`, kind: 'info', pids: [p.id], link: { page: 'negotiate', args: ['fa', p.id] },
      text: `Respectfully, ${deal(mine)} isn't close for ${posLabel(p)} ${pname(p)}.${rivalLine} He's thinking more like ${deal(need)}.`,
    });
  }
}

// Another club just made an offer: if it beats yours, his agent lets you know.
export function rivalAlert(league: League, p: Player, rivalOffer: FaOffer): void {
  const fa = p.fa;
  if (!fa || fa.pending) return;
  const mine = fa.offers.find((o) => o.orgId === league.userOrgId);
  if (!mine) return;
  if (fa.talk?.noted !== undefined && league.day - fa.talk.noted < 4) return;
  const s = offerScore(league, p, mine);
  const r = offerScore(league, p, rivalOffer);
  if (r <= s) return;
  fa.talk = { respondDay: fa.talk?.respondDay ?? -1, counter: fa.talk?.counter, noted: league.day };
  const need = whatItTakes(league, p, mine, r + 0.03);
  const yrs = rivalOffer.years === mine.years ? 'the same length' : rivalOffer.years > mine.years ? `more years (${rivalOffer.years})` : `fewer years (${rivalOffer.years})`;
  addInbox(league, {
    from: agentFrom(p), subject: `${pname(p)}: you've been topped`, kind: 'info', pids: [p.id], link: { page: 'negotiate', args: ['fa', p.id] },
    text: `Heads up: another club has made ${p.first} a stronger offer, ${yrs}, worth about ${Math.round((r / Math.max(0.01, s) - 1) * 100)}% more to him than yours. To get back in front you'd need about ${deal(need)}. He decides by ${dayShort(league.season, fa.decideDay)}.`,
  });
}

// Your answer to his counter.
export function answerFaReply(league: League, msg: InboxMsg, key: string): string {
  msg.read = true;
  const p = msg.faPid !== undefined ? league.players[msg.faPid] : undefined;
  if (!p || !p.fa || p.orgId !== null) { msg.resolved = 'Expired'; return 'He has already made his decision.'; }
  const c = p.fa.talk?.counter;
  if (key === 'revise') { msg.resolved = 'Revising'; return ''; }
  if (key !== 'accept') { msg.resolved = 'Held firm'; return `You held firm. ${p.first} still has your offer and decides by ${dayShort(league.season, p.fa.decideDay)}.`; }
  if (!c) { msg.resolved = 'Expired'; return 'That counter is no longer on the table.'; }
  p.fa.offers = p.fa.offers.filter((o) => o.orgId !== league.userOrgId);
  const o: FaOffer = { ...c, orgId: league.userOrgId, day: league.day };
  p.fa.offers.push(o);
  msg.resolved = 'Accepted';
  const how = closeWithUser(league, p, o);
  return how === 'signed' ? `Done: ${pname(p)} signed, ${deal(o)}.` : `${pname(p)} agreed to ${deal(o)}. Make a roster move to finalize it.`;
}
