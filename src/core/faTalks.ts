// Free agent negotiation with you, as an ongoing conversation with his agent:
//  - Every offer you make gets an answer in a day or three: he takes it, his
//    agent tells you the range he's looking for, or that you're not close.
//    Agents never hand you the exact number: you still have to make the offer.
//  - When another club tops your offer, his agent lets you know roughly what
//    that deal looks like, at most once every few days.
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
const roundM = (x: number, step: number) => Math.max(step, Math.round(x / step) * step);
// A range around what it would take, never centered on the exact number.
function rangeFor(o: FaOffer): { lo: number; hi: number; years: number } {
  const step = o.aav >= 10e6 ? 0.5e6 : 0.25e6;
  const lo = roundM(o.aav * (0.9 + 0.07 * rand()), step);
  const hi = Math.max(lo + step, roundM(o.aav * (1.06 + 0.1 * rand()), step));
  return { lo, hi, years: o.years };
}
const rangeText = (r: { lo: number; hi: number; years: number }) => `${fmtMoney(r.lo)}–${fmtMoney(r.hi)} a year over ${r.years === 1 ? 'one year' : `about ${r.years} years`}`;
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
    const rivalLine = rival && r > s ? ' Another club has offered more.' : rival ? ` You're ahead of the ${fa.offers.length - 1 === 1 ? 'other offer' : `${fa.offers.length - 1} other offers`} right now.` : ' Nobody else has made an offer yet.';
    // He takes it: clearly the best deal and at or above his number (bigger names take a little longer).
    if (s >= 1.0 && s >= r + 0.04 && rand() < (notable ? 0.55 : 0.85)) {
      const how = closeWithUser(league, p, mine);
      if (how === 'signed') return; // signFreeAgentOffer sends the "signed with you" note
      continue;
    }
    // Ranges are priced at the length that matters: the leading rival's, or what he's asking.
    const len = rival && r > s ? rival.o.years : fa.asking.years;
    const base: FaOffer = len === mine.years ? mine : { ...mine, years: len, terms: undefined };
    if (s >= 0.8) {
      // Close: his agent names a range, not the number.
      const r2 = rangeFor(whatItTakes(league, p, base, Math.max(1.02, r + 0.05)));
      fa.talk.range = r2;
      addInbox(league, {
        from: agentFrom(p), subject: `${pname(p)}: we're close`, kind: 'fa-reply', pids: [p.id], faPid: p.id, stop: true,
        link: { page: 'negotiate', args: ['fa', p.id] },
        text: `We appreciate the offer (${deal(mine)}${mine.terms ? `; ${describeContract(league, buildContract(mine.terms, league.season + 1, league.season))}` : ''}).${rivalLine} We're looking for a contract in the range of ${rangeText(r2)}. He decides by ${dayShort(league.season, fa.decideDay)} either way.`,
        actions: [{ key: 'revise', label: 'Revise my offer' }, { key: 'pass', label: 'Hold firm' }],
      });
      continue;
    }
    const r3 = rangeFor(whatItTakes(league, p, base, Math.max(1.0, r + 0.02)));
    fa.talk.range = r3;
    addInbox(league, {
      from: agentFrom(p), subject: `${pname(p)}: not close`, kind: 'info', pids: [p.id], link: { page: 'negotiate', args: ['fa', p.id] },
      text: `Respectfully, ${deal(mine)} isn't close for ${posLabel(p)} ${pname(p)}.${rivalLine} He's looking for something in the range of ${rangeText(r3)}.`,
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
  fa.talk = { respondDay: fa.talk?.respondDay ?? -1, range: fa.talk?.range, noted: league.day };
  // What the rival deal looks like, roughly (rounded, no clauses spelled out).
  const approx = roundM(rivalOffer.aav, rivalOffer.aav >= 10e6 ? 1e6 : 0.5e6);
  const extras = rivalOffer.terms && (rivalOffer.terms.optOuts?.length || rivalOffer.terms.ntc || rivalOffer.terms.option) ? ', with some extras' : '';
  addInbox(league, {
    from: agentFrom(p), subject: `${pname(p)}: you've been topped`, kind: 'info', pids: [p.id], link: { page: 'negotiate', args: ['fa', p.id] },
    text: `Heads up: another club has made ${p.first} a stronger offer: ${rivalOffer.years === 1 ? 'one year' : `${rivalOffer.years} years`} at around ${fmtMoney(approx)} a year${extras}. If you can top it, we'll talk. He decides by ${dayShort(league.season, fa.decideDay)}.`,
  });
}

// Your answer to his agent: revise (opens the offer builder) or hold firm.
export function answerFaReply(league: League, msg: InboxMsg, key: string): string {
  msg.read = true;
  const p = msg.faPid !== undefined ? league.players[msg.faPid] : undefined;
  if (!p || !p.fa || p.orgId !== null) { msg.resolved = 'Expired'; return 'He has already made his decision.'; }
  if (key === 'revise') { msg.resolved = 'Revising'; return ''; }
  msg.resolved = 'Held firm';
  return `You held firm. ${p.first} still has your offer and decides by ${dayShort(league.season, p.fa.decideDay)}.`;
}
