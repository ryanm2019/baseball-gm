// Trade talks with AI clubs take time: you send an offer and the other front
// office answers in a day or two (the same day at the deadline). They accept
// (the deal goes through at once), decline with a reason, or counter. After a few
// rounds without a deal, or a lowball, they stop taking your calls for a while.
import type { League, Org, TradeAssets, TradeProposal, TradeTalk, InboxMsg } from './types.ts';
import { balanceForAi, emptyAssets, evaluate, executeTrade, rosterTodo, tradable, tradeWindowOpen, validateTrade, aiAccepts } from './trade.ts';
import { addInbox } from './morale.ts';
import { posLabel } from './rules.ts';
import { fmtMoney, orgPayroll } from './contracts.ts';
import { agmEvalSd } from './staff.ts';
import { tradeValue } from './value.ts';
import { normal, rand, seededNormal } from './random.ts';

const ROUNDS = 3; // rounds without a deal before they stop taking calls
const COUNTER_DAYS = 3;

export function assetsText(league: League, a: TradeAssets): string {
  const parts = a.pids.map((id) => {
    const p = league.players[id];
    return p ? `${posLabel(p)} ${p.first} ${p.last}` : '?';
  });
  if (a.cash) parts.push(`${fmtMoney(a.cash)} cash`);
  if (a.pool) parts.push(`${fmtMoney(a.pool)} international pool money`);
  for (const id of a.cbPicks) parts.push(`competitive balance pick ${id.split('-').slice(0, 2).join(' ')}`);
  return parts.length ? parts.join(', ') : 'nothing';
}

const isDeadlineDay = (league: League) => league.phase === 'regular' && league.day === league.settings.tradeDeadlineDay;

// How long they take to answer: 1-2 days, next day in the deadline's final
// days, and within the day on deadline day.
function replyDelay(league: League): number {
  if (isDeadlineDay(league)) return 0;
  const toDeadline = league.settings.tradeDeadlineDay - league.day;
  if (league.phase === 'regular' && toDeadline >= 1 && toDeadline <= 3) return 1;
  return rand() < 0.5 ? 1 : 2;
}

function relation(league: League, orgId: number) {
  league.tradeRelations ??= {};
  const r = league.tradeRelations[orgId];
  if (!r || r.season !== league.season) league.tradeRelations[orgId] = { season: league.season, rounds: 0, frozenUntil: -1 };
  return league.tradeRelations[orgId];
}

// If they're not taking your calls, why (and until when).
export function talksFrozen(league: League, orgId: number): string | null {
  const r = relation(league, orgId);
  if (r.frozenUntil > league.day) {
    const d = r.frozenUntil - league.day;
    return `The ${league.orgs[orgId].affiliates.MLB.name} aren't taking your calls right now (try again in ${d} day${d === 1 ? '' : 's'}).`;
  }
  return null;
}

// Packages a club itself put on the table (via Trade Finder): send it as is
// within a few days and they'll take it.
const FLOAT_DAYS = 3;
const sig = (prop: TradeProposal) => [prop.orgs.join('-'), ...prop.give.map((g) => [[...g.pids].sort((a, b) => a - b).join('.'), g.cash, g.pool, [...g.cbPicks].sort().join('.')].join('/'))].join('|');
export function markFloated(league: League, prop: TradeProposal): void {
  league.tradeFloated = [...(league.tradeFloated ?? []).filter((f) => league.day - f.day <= FLOAT_DAYS), { sig: sig(prop), day: league.day }].slice(-30);
}
export function isFloated(league: League, prop: TradeProposal): boolean {
  const s = sig(prop);
  return (league.tradeFloated ?? []).some((f) => f.sig === s && league.day - f.day <= FLOAT_DAYS) && aiAccepts(league, league.orgs[prop.orgs[1]], prop);
}

export const openTalks = (league: League) => (league.tradeTalks ?? []).filter((t) => t.status === 'waiting' || t.status === 'countered');

// Send an offer. Returns what to tell the user.
export function sendOffer(league: League, prop: TradeProposal): string {
  const err = validateTrade(league, prop);
  if (err) return err;
  const ai = league.orgs[prop.orgs[1]];
  const frozen = talksFrozen(league, ai.id);
  if (frozen) return frozen;
  league.tradeTalks ??= [];
  // A new offer to the same club replaces any open one with them.
  for (const t of openTalks(league)) if (t.orgId === ai.id) { t.status = 'withdrawn'; resolveMsg(league, t, 'Replaced by your new offer'); }
  const prev = league.tradeTalks.filter((t) => t.orgId === ai.id && t.season === league.season).length;
  const talk: TradeTalk = {
    id: league.nextId.tx++,
    orgId: ai.id,
    season: league.season,
    sentDay: league.day,
    respondDay: league.day + replyDelay(league),
    round: prev + 1,
    proposal: JSON.parse(JSON.stringify(prop)),
    status: 'waiting',
    noise: isFloated(league, prop) ? Math.abs(normal(0, 0.05)) + 0.05 : normal(0, 0.05),
  };
  league.tradeTalks.push(talk);
  if (league.tradeTalks.length > 60) league.tradeTalks.splice(0, league.tradeTalks.length - 60);
  if (talk.respondDay === league.day) {
    const msg = respond(league, talk, false);
    return `It's deadline day, so they got back to you within the hour. ${msg}`;
  }
  const d = talk.respondDay - league.day;
  return `Offer sent to the ${ai.affiliates.MLB.name}. Expect an answer in ${d === 1 ? 'a day' : `${d} days`}; it'll land in your Inbox.`;
}

export function withdrawOffer(league: League, talkId: number): void {
  const t = (league.tradeTalks ?? []).find((x) => x.id === talkId);
  if (t && (t.status === 'waiting' || t.status === 'countered')) {
    t.status = 'withdrawn';
    resolveMsg(league, t, 'Withdrawn');
  }
}

function resolveMsg(league: League, t: TradeTalk, label: string): void {
  for (const m of league.inbox ?? []) if (m.talkId === t.id && !m.resolved && m.actions) m.resolved = label;
}

// Why they said no, in their words.
function declineReason(league: League, ai: Org, prop: TradeProposal, gap: number, sent: number): string {
  const salaryIn = prop.give[0].pids.reduce((t, id) => t + (league.players[id]?.contract.salary ?? 0), 0) - prop.give[0].cash;
  const salaryOut = prop.give[1].pids.reduce((t, id) => t + (league.players[id]?.contract.salary ?? 0), 0) - prop.give[1].cash;
  if (salaryIn - salaryOut > 2e6 && orgPayroll(league, ai).cbt + salaryIn - salaryOut > ai.budget) return 'We can\'t take on that much salary.';
  if (gap > Math.max(10e6, Math.abs(sent) * 0.5)) return 'That isn\'t close to what we\'d need.';
  if (ai.strategy === 'Rebuild' && prop.give[0].pids.every((id) => (league.season - (league.players[id]?.born ?? 0)) >= 29)) return 'We\'re rebuilding; we need younger talent back.';
  if (ai.strategy === 'Contend' && prop.give[0].pids.every((id) => league.players[id]?.level !== 'MLB')) return 'We\'re trying to win now; we need help at the big-league level.';
  return 'We need more value coming back.';
}

// Their counter: keep what you asked for but ask for a bit more, or keep the
// rest of your package and hold back one of their pieces. Whichever is closer.
function buildCounter(league: League, prop: TradeProposal): TradeProposal | null {
  const ai = league.orgs[prop.orgs[1]];
  const options: TradeProposal[] = [];
  const more = balanceForAi(league, prop);
  if (more && more.give[0].pids.length - prop.give[0].pids.length <= 2) options.push(more);
  if (prop.give[1].pids.length > 1) {
    const theirs = [...prop.give[1].pids].sort((a, b) => tradeValue(league, ai, league.players[b], false) - tradeValue(league, ai, league.players[a], false));
    for (const id of theirs) {
      const less: TradeProposal = JSON.parse(JSON.stringify(prop));
      less.give[1].pids = less.give[1].pids.filter((x) => x !== id);
      if (!validateTrade(league, less) && aiAccepts(league, ai, less)) { options.push(less); break; }
    }
  }
  if (!options.length) return null;
  // Closest to what you offered, from your side.
  const user = league.orgs[league.userOrgId];
  options.sort((a, b) => evaluate(league, user, b).dv - evaluate(league, user, a).dv);
  return options[0];
}

// Their answer. `stop` pauses the sim (not needed when you're on the trade screen).
function respond(league: League, t: TradeTalk, stop = true): string {
  const ai = league.orgs[t.orgId];
  const name = ai.affiliates.MLB.name;
  const from = `${ai.region} ${ai.name} front office`;
  const what = `your offer (${assetsText(league, t.proposal.give[0])} for ${assetsText(league, t.proposal.give[1])})`;
  const closed = tradeWindowOpen(league);
  const invalid = closed ? `${closed}.` : validateTrade(league, t.proposal);
  const injured = [...t.proposal.give[0].pids, ...t.proposal.give[1].pids].map((id) => league.players[id]).find((p) => p?.il && p.il.since >= t.sentDay);
  if (invalid || injured) {
    t.status = 'withdrawn';
    const why = injured ? `${injured.first} ${injured.last} went on the injured list` : invalid;
    addInbox(league, { from, subject: `Offer off the table (${ai.abbrev})`, kind: 'info', pids: t.proposal.give[1].pids, talkId: t.id, text: `The ${name} pulled back from ${what}: ${why}` });
    return `The ${name} pulled back: ${why}`;
  }
  const rel = relation(league, ai.id);
  const e = evaluate(league, ai, t.proposal);
  const wiggle = t.noise * Math.max(2e6, Math.abs(e.sent));
  if (e.dv + wiggle >= e.need) {
    t.status = 'done'; // before executing, so it isn't treated as a conflicting offer
    const err = executeTrade(league, t.proposal);
    if (err) {
      t.status = 'withdrawn';
      addInbox(league, { from, subject: `Deal fell through (${ai.abbrev})`, kind: 'info', pids: t.proposal.give[1].pids, talkId: t.id, text: `The ${name} agreed to ${what}, but it couldn't be completed: ${err}` });
      return `They agreed, but it couldn't be completed: ${err}`;
    }
    t.status = 'done';
    rel.rounds = 0;
    const todo = rosterTodo(league);
    addInbox(league, { from, subject: `Trade accepted: ${ai.abbrev}`, kind: 'trade-reply', pids: t.proposal.give[1].pids, talkId: t.id, stop, text: `The ${name} accepted ${what}. The trade is done.${todo}`, link: { page: todo && !league.orgs[league.userOrgId].agm.roster ? 'roster-moves' : 'transactions' } });
    return `The ${name} accepted. The trade is done.${todo}`;
  }
  rel.rounds += 1;
  const gap = e.need - e.dv;
  const lowball = gap > Math.max(15e6, Math.abs(e.sent) * 0.6);
  if (lowball) rel.rounds += 1;
  const nearDl = league.phase === 'regular' && league.settings.tradeDeadlineDay - league.day <= 7 && league.settings.tradeDeadlineDay >= league.day;
  const freeze = rel.rounds >= ROUNDS;
  if (freeze) rel.frozenUntil = league.day + (nearDl ? 2 : 14);
  const frozenNote = freeze ? ` They've heard enough for now and won't take your calls for ${nearDl ? 'a couple of days' : 'two weeks'}.` : '';
  const counter = freeze || lowball ? null : buildCounter(league, t.proposal);
  if (counter) {
    t.status = 'countered';
    t.counter = counter;
    t.counterExpires = league.day + (isDeadlineDay(league) ? 0 : COUNTER_DAYS);
    const theyWant = counter.give[0].pids.filter((id) => !t.proposal.give[0].pids.includes(id));
    const theyKeep = t.proposal.give[1].pids.filter((id) => !counter.give[1].pids.includes(id));
    const change = [theyWant.length ? `add ${assetsText(league, { ...emptyAssets(), pids: theyWant })}` : '', theyKeep.length ? `they keep ${assetsText(league, { ...emptyAssets(), pids: theyKeep })}` : ''].filter(Boolean).join(' and ');
    addInbox(league, {
      from, subject: `Counteroffer: ${ai.abbrev}`, kind: 'trade-reply', talkId: t.id, stop,
      pids: [...new Set([...counter.give[1].pids, ...counter.give[0].pids])],
      text: `The ${name} won't do ${what}, but they'd do it if you ${change}: ${assetsText(league, counter.give[0])} for ${assetsText(league, counter.give[1])}. The offer is good ${t.counterExpires === league.day ? 'until the deadline' : `for ${COUNTER_DAYS} days`}.`,
      actions: [{ key: 'accept', label: 'Accept their counter' }, { key: 'revise', label: 'Counter back (open in Trade)' }, { key: 'decline', label: 'Decline' }],
    });
    return `The ${name} countered: ${assetsText(league, counter.give[0])} for ${assetsText(league, counter.give[1])}. See your Inbox to accept, counter back or decline.`;
  }
  t.status = 'declined';
  const reason = lowball ? 'Frankly, that offer isn\'t serious.' : declineReason(league, ai, t.proposal, gap, e.sent);
  addInbox(league, { from, subject: `Offer declined: ${ai.abbrev}`, kind: 'info', pids: t.proposal.give[1].pids, talkId: t.id, text: `The ${name} turned down ${what}. "${reason}"${frozenNote}` });
  return `The ${name} declined. "${reason}"${frozenNote}`;
}

// Your answer to their counter.
export function answerCounter(league: League, msg: InboxMsg, key: string): string {
  const t = (league.tradeTalks ?? []).find((x) => x.id === msg.talkId);
  msg.read = true;
  if (!t || t.status !== 'countered' || !t.counter) { msg.resolved = 'No longer available'; return 'That counter is no longer on the table.'; }
  const ai = league.orgs[t.orgId];
  if (key === 'decline') {
    t.status = 'declined';
    msg.resolved = 'Declined';
    return `You declined the ${ai.affiliates.MLB.name}' counter.`;
  }
  if (key === 'revise') {
    msg.resolved = 'Countered back';
    t.status = 'withdrawn';
    return 'Their counter is loaded in the Trade screen. Adjust it and send your counter.';
  }
  const err = tradeWindowOpen(league) ?? validateTrade(league, t.counter);
  if (err) { t.status = 'withdrawn'; msg.resolved = 'No longer possible'; return `It can't be done anymore: ${err}`; }
  t.status = 'done'; // before executing, so it isn't treated as a conflicting offer
  const done = executeTrade(league, t.counter);
  if (done) { t.status = 'withdrawn'; msg.resolved = 'Failed'; return done; }
  relation(league, t.orgId).rounds = 0;
  msg.resolved = 'Accepted';
  return `Deal. You traded ${assetsText(league, t.counter.give[0])} to the ${ai.affiliates.MLB.name} for ${assetsText(league, t.counter.give[1])}.${rosterTodo(league)}`;
}

// Daily: answers come due, counters expire, the deadline closes talks.
export function talksDay(league: League): string | null {
  let stop: string | null = null;
  for (const t of openTalks(league)) {
    if (t.status === 'waiting' && league.day >= t.respondDay) {
      const before = (league.inbox ?? []).length;
      respond(league, t);
      const m = (league.inbox ?? [])[before];
      if (m?.stop) stop ??= `Inbox: ${m.subject}. Answer it on the Inbox page.`;
    } else if (t.status === 'countered' && t.counterExpires !== undefined && (league.day > t.counterExpires || tradeWindowOpen(league))) {
      t.status = 'expired';
      resolveMsg(league, t, 'Expired');
    }
  }
  return stop;
}

// ---------- your assistant GM's read on a deal ----------

export interface AgmRead {
  mine: string; // would he do it
  mineTone: 'pos' | 'neg' | '';
  theirs: string; // will they accept
  theirsTone: 'pos' | 'neg' | '';
}

// "Would I do this?" uses your club's own valuation; "Will they accept?" is his
// estimate of their side, as good as his evaluation skill (fixed per proposal so
// it doesn't flicker).
export function agmRead(league: League, prop: TradeProposal): AgmRead {
  const user = league.orgs[league.userOrgId];
  const ai = league.orgs[prop.orgs[1]];
  const mine = evaluate(league, user, prop);
  const scale = Math.max(2e6, Math.abs(mine.sent), Math.abs(mine.received));
  const net = mine.dv / scale;
  const mineTxt = net > 0.15 ? `Yes. We come out ahead (about ${fmtMoney(mine.dv)} in value).` : net > -0.05 ? 'It\'s about even for us. Fine if it fills a need.' : net > -0.25 ? `I'd lean no; we're giving up a bit more than we get (about ${fmtMoney(-mine.dv)}).` : `No. We'd be overpaying by about ${fmtMoney(-mine.dv)}.`;
  const frozen = talksFrozen(league, ai.id);
  if (!frozen && isFloated(league, prop)) return { mine: mineTxt, mineTone: net > 0.15 ? 'pos' : net <= -0.05 ? 'neg' : '', theirs: 'They put this package on the table themselves; they\'ll take it.', theirsTone: 'pos' };
  const est = agmEstimate(league, prop);
  const theirsTxt = frozen ? frozen : est > 0.12 ? 'Likely. I think they say yes.' : est > -0.05 ? 'Could go either way.' : est > -0.3 ? 'Unlikely as is; expect a counter.' : 'No chance. They\'ll laugh at it.';
  return { mine: mineTxt, mineTone: net > 0.15 ? 'pos' : net <= -0.05 ? 'neg' : '', theirs: theirsTxt, theirsTone: frozen ? 'neg' : est > 0.12 ? 'pos' : est <= -0.05 ? 'neg' : '' };
}

// His read on how the other club values it: their true margin plus his own
// evaluation error (fixed per proposal and week, so it doesn't flicker).
function agmEstimate(league: League, prop: TradeProposal): number {
  const user = league.orgs[league.userOrgId];
  const ai = league.orgs[prop.orgs[1]];
  const theirs = evaluate(league, ai, prop);
  const key = [...prop.give[0].pids, -1, ...prop.give[1].pids, prop.give[0].cash, prop.give[1].cash].reduce((h, x) => (h * 31 + x) | 0, 7);
  const sd = agmEvalSd(league, user) / 5; // 0 (great AGM) .. 1 (none)
  return (theirs.dv - theirs.need) / Math.max(2e6, Math.abs(theirs.sent)) + seededNormal(key, league.day >> 3) * (0.08 + 0.25 * sd);
}

// "Ask your assistant GM": he adds the least he thinks it takes until he
// believes they'll say yes. As good as his read: no guarantee until they answer.
export function agmSuggestion(league: League, prop: TradeProposal): { prop: TradeProposal; text: string } | null {
  const ai = league.orgs[prop.orgs[1]];
  const next: TradeProposal = JSON.parse(JSON.stringify(prop));
  for (let step = 0; step < 4 && agmEstimate(league, next) <= 0.12; step++) {
    const cands = tradable(league, league.userOrgId)
      .filter((p) => !next.give[0].pids.includes(p.id))
      .map((p) => ({ p, v: tradeValue(league, ai, p, true) }))
      .filter((x) => x.v > 0.5e6)
      .filter((x) => { next.give[0].pids.push(x.p.id); const ok = !validateTrade(league, next); next.give[0].pids.pop(); return ok; })
      .sort((x, y) => x.v - y.v);
    if (!cands.length) return null;
    const enough = cands.find((x) => { next.give[0].pids.push(x.p.id); const ok = agmEstimate(league, next) > 0.12; next.give[0].pids.pop(); return ok; });
    next.give[0].pids.push((enough ?? cands[cands.length - 1]).p.id);
  }
  if (agmEstimate(league, next) <= 0.12) return null;
  const add = next.give[0].pids.filter((id) => !prop.give[0].pids.includes(id));
  if (!add.length) return { prop: next, text: 'I think this works as is.' };
  return { prop: next, text: `My guess: add ${assetsText(league, { ...emptyAssets(), pids: add })} and they'll probably bite. No guarantees until they answer.` };
}
