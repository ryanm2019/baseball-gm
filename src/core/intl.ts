// International amateur free agency, OOTP-style:
//  Dec 15  the class is revealed with asking ranges (as wide as your
//          international scouting is poor); bonus pools are set (hard cap).
//  Dec 15 - Jan 14  negotiation: offers, a willingness meter, other clubs
//          bidding, verbal agreements (breakable by a much bigger offer).
//  Jan 1   negotiation day: late reports move prices; some verbals fall apart.
//  Jan 15  signing day: verbals become contracts. Unsigned players stay
//          available all year at falling prices.
// Also: pros posted from Asian leagues each winter. Players 25+ are free
// agents (45-day window, posting fee to their club); younger ones (the
// Ohtani/Sasaki rule) sign minor league deals out of the bonus pool.
import type { IfaInfo, League, Org, Player } from './types.ts';
import { generatePlayer } from './playerGen.ts';
import { clamp, normal, rand, randInt, seededNormal } from './random.ts';
import { ovr, potOvr, scoutFactor } from './ratings.ts';
import { fmtMoney, milbContract, roundSalary } from './contracts.ts';
import { addNews, addTransaction, pname, touchRosters } from './util.ts';
import { delegated, staffOf } from './staff.ts';
import { logMove, side } from './moves.ts';
import { originFrom } from './names.ts';
import { openFreeAgent } from './freeAgency.ts';
import { addInbox } from './morale.ts';

export function poolFor(market: number): number {
  return market < 0.8 ? 7_555_500 : market <= 1.1 ? 6_908_600 : 6_261_600;
}

export const isIfa = (p: Player) => !!p.ifa && p.orgId === null;

export type IfaPhase = 'closed' | 'negotiation' | 'open';

export function ifaPhase(league: League): IfaPhase {
  if (league.intl.open) return 'open';
  if (league.phase === 'offseason' && league.events.includes('ifa-class') && league.intl.year === league.season + 1) return 'negotiation';
  return 'closed';
}

export function generateIfaClass(league: League, year: number): void {
  const n = league.orgs.length * 14;
  const made: Player[] = [];
  for (let i = 0; i < n; i++) {
    const p = generatePlayer({
      id: league.nextId.player++,
      season: year,
      level: 'DSL',
      orgId: null,
      age: rand() < 0.7 ? 16 : 17,
      international: true,
      talentShift: normal(-2, 2),
    });
    p.level = null;
    p.proSeasons = 0;
    p.ifa = { year, asking: 10_000 };
    milbContract(p, year, 'DSL');
    league.players[p.id] = p;
    made.push(p);
  }
  // Asking bonuses follow the market's view of each kid.
  made.sort((a, b) => potOvr(b) - potOvr(a));
  made.forEach((p, i) => {
    const ask = i < 8 ? 4_000_000 * Math.exp(-i / 6) : i < 60 ? 1_800_000 * Math.exp(-(i - 8) / 18) : i < 150 ? 250_000 * Math.exp(-(i - 60) / 60) : 10_000;
    p.ifa!.asking = roundSalary(Math.max(10_000, ask * (0.85 + rand() * 0.3)));
  });
}

// Dec 15: next period's pools are set (QO penalties come off the top).
export function setupIfaPools(league: League): void {
  league.intl = { pools: {}, spent: {}, open: false, acquired: {}, base: {}, year: league.season + 1 };
  for (const o of league.orgs) {
    const base = poolFor(o.market);
    const pen = league.ifaPenalty[o.id] ?? 0;
    league.intl.base![o.id] = base;
    league.intl.pools[o.id] = Math.max(0, base - pen);
    league.intl.spent[o.id] = 0;
    league.intl.acquired![o.id] = 0;
    if (pen && o.id === league.userOrgId) addNews(league, o.id, `Your international bonus pool is reduced by ${fmtMoney(pen)} (qualifying-offer penalty).`);
  }
  league.ifaPenalty = {};
  addNews(league, null, 'The international class has been revealed. Clubs can negotiate until signing day, January 15; verbal agreements become contracts then.');
}

// Jan 15: signing day.
export function openIfaPeriod(league: League): void {
  if (league.intl.year !== league.season + 1 && league.intl.year !== league.season) setupIfaPools(league); // older saves
  league.intl.open = true;
  const signed: { p: Player; orgId: number; amount: number }[] = [];
  for (const p of Object.values(league.players)) {
    if (!isIfa(p) || !p.ifa!.verbal) continue;
    const v = p.ifa!.verbal;
    signed.push({ p, orgId: v.orgId, amount: v.amount });
  }
  for (const s of signed) {
    s.p.ifa!.verbal = null;
    signIfa(league, s.orgId, s.p, s.amount);
  }
  signed.sort((a, b) => b.amount - a.amount);
  const mine = signed.filter((s) => s.orgId === league.userOrgId);
  if (mine.length) {
    addInbox(league, {
      from: 'International scouting', subject: `Signing day: ${mine.length} international player${mine.length === 1 ? '' : 's'} signed`, kind: 'info', pids: mine.map((s) => s.p.id), stop: true,
      text: `${mine.map((s) => `${pname(s.p)} (${s.p.country}, ${fmtMoney(s.amount)})`).join('; ')}. They report to your Dominican Summer League and complex teams.`,
    });
  }
  const top = signed.slice(0, 5).map((s) => `${pname(s.p)} (${league.orgs[s.orgId].abbrev}, ${fmtMoney(s.amount)})`);
  addNews(league, null, `International signing day: ${signed.length} players signed.${top.length ? ` Top bonuses: ${top.join(', ')}.` : ''}`, signed.slice(0, 5).map((s) => s.p.id));
}

// ---------- money ----------

export function verbalTotal(league: League, orgId: number): number {
  let t = 0;
  for (const p of Object.values(league.players)) if (isIfa(p) && p.ifa!.verbal?.orgId === orgId) t += p.ifa!.verbal.amount;
  return t;
}

// Pool money not yet signed or promised. Pools are a hard cap.
export function poolLeft(league: League, orgId: number): number {
  return (league.intl.pools[orgId] ?? 0) - (league.intl.spent[orgId] ?? 0) - verbalTotal(league, orgId);
}

// ---------- the player's side ----------

// His price right now: his asking, how much he's dug in, and the best offer
// from anyone else (competition pushes the price up).
export function ifaTarget(p: Player, exceptOrg: number): number {
  const info = p.ifa!;
  let rival = 0;
  for (const [org, amt] of Object.entries(info.bids ?? {})) if (Number(org) !== exceptOrg) rival = Math.max(rival, amt);
  let t = Math.max(info.asking * (info.stiff ?? 1), rival * 1.02);
  // Breaking a verbal takes a clearly better offer.
  if (info.verbal && info.verbal.orgId !== exceptOrg) t = Math.max(t, info.verbal.amount * 1.15);
  return t;
}

const acceptChance = (amount: number, target: number) => 1 / (1 + Math.exp(-(amount / target - 1) / 0.045));

// What a club's international scouts think he'll ask for: a range, wider and
// more off-center with weaker scouting.
export function askingRange(league: League, p: Player, orgId = league.userOrgId): { lo: number; hi: number; mid: number } {
  const f = scoutFactor(league, league.orgs[orgId], 'intl');
  const mid = p.ifa!.asking * (p.ifa!.stiff ?? 1) * Math.exp(0.12 * f * seededNormal(p.scoutSeed, orgId, 3131));
  const half = 0.08 + 0.17 * f;
  const r = (x: number) => Math.max(10_000, Math.round(x / 10_000) * 10_000);
  return { lo: r(mid * (1 - half)), hi: r(mid * (1 + half)), mid: r(mid) };
}

// The meter: how likely he is to take this offer, as your scouts read it.
export function ifaWillingness(league: League, p: Player, amount: number, orgId = league.userOrgId): number {
  const f = scoutFactor(league, league.orgs[orgId], 'intl');
  const misread = Math.exp(0.1 * f * seededNormal(p.scoutSeed, orgId, 4141));
  return acceptChance(amount, ifaTarget(p, orgId) * misread);
}

export function ifaBidders(league: League, p: Player): Org[] {
  return Object.keys(p.ifa?.bids ?? {}).map(Number).filter((id) => id !== league.userOrgId).map((id) => league.orgs[id]);
}

export function canOfferIfa(league: League, orgId: number, p: Player, amount?: number): string | null {
  const phase = ifaPhase(league);
  if (phase === 'closed') return 'Negotiations open when the class is revealed (December 15)';
  if (!isIfa(p)) return 'Not available';
  const info = p.ifa!;
  if (info.verbal?.orgId === orgId) return 'Already agreed: he signs on January 15';
  const last = info.lastOffer?.[orgId];
  if (last !== undefined && league.day - last < 7) return `One offer a week: next offer ${7 - (league.day - last)} day(s)`;
  if (amount !== undefined && amount > poolLeft(league, orgId)) return 'Not enough pool money left (pools are a hard cap)';
  if (poolLeft(league, orgId) < 10_000) return 'No pool money left';
  return null;
}

// One official offer. Before signing day an accepted offer is a verbal
// agreement; from signing day on he signs on the spot.
// The user hears about it when someone he's after goes elsewhere (or backs out of his deal).
function ifaLostNotice(league: League, p: Player, toOrg: number, amount: number, hadVerbal: boolean, why = ''): void {
  const u = league.userOrgId;
  if (toOrg === u) return;
  const info = p.ifa;
  const wasBidding = hadVerbal || info?.lastOffer?.[u] !== undefined || (info?.bids?.[u] ?? 0) > 0;
  if (!wasBidding) return;
  const team = league.orgs[toOrg].affiliates.MLB.name;
  addInbox(league, {
    from: 'International scouting', kind: 'info', pids: [p.id], stop: true, link: { page: 'international' },
    subject: hadVerbal ? `${pname(p)} backed out of his deal with you` : `${pname(p)} went to the ${team}`,
    text: `${why}${p.pos} ${pname(p)} (${p.country}) ${hadVerbal ? 'backed out of his agreement with you and ' : ''}agreed to terms with the ${team} for ${fmtMoney(amount)}${ifaPhase(league) === 'open' ? '' : ', to sign January 15'}.${info?.bids?.[u] ? ` Your best offer was ${fmtMoney(info.bids[u])}.` : ''}`,
  });
}

export function offerIfa(league: League, orgId: number, p: Player, amount: number): { ok: boolean; text: string } {
  amount = Math.max(10_000, roundSalary(amount));
  const why = canOfferIfa(league, orgId, p, amount);
  if (why) return { ok: false, text: why };
  const info = p.ifa!;
  info.lastOffer ??= {};
  info.lastOffer[orgId] = league.day;
  info.bids ??= {};
  info.bids[orgId] = Math.max(info.bids[orgId] ?? 0, amount);
  const target = ifaTarget(p, orgId);
  const org = league.orgs[orgId];
  if (rand() < acceptChance(amount, target)) {
    const prev = info.verbal;
    ifaLostNotice(league, p, orgId, amount, prev?.orgId === league.userOrgId);
    if (ifaPhase(league) === 'open') {
      info.verbal = null;
      signIfa(league, orgId, p, amount);
      return { ok: true, text: `${pname(p)} signed for ${fmtMoney(amount)}.` };
    }
    info.verbal = { orgId, amount, day: league.day };
    if (prev && prev.orgId !== orgId) {
      const other = league.orgs[prev.orgId];
      addNews(league, null, `${pname(p)} backed out of his agreement with the ${other.affiliates.MLB.name} and agreed to terms with the ${org.affiliates.MLB.name} (${fmtMoney(amount)}).`, [p.id]);
      if (prev.orgId === league.userOrgId) addNews(league, prev.orgId, `Bad news: ${pname(p)} backed out of his verbal agreement with you for a bigger offer from the ${org.affiliates.MLB.name}.`, [p.id]);
    } else if (amount >= 1_000_000 || orgId === league.userOrgId) {
      addNews(league, orgId === league.userOrgId ? orgId : null, `${pname(p)} (${p.country}) agreed to terms with the ${org.affiliates.MLB.name}: ${fmtMoney(amount)}, to sign January 15.`, [p.id]);
    }
    return { ok: true, text: `${pname(p)} agreed to ${fmtMoney(amount)}. He signs on January 15${prev && prev.orgId !== orgId ? ` (he backed out of a deal with ${league.orgs[prev.orgId].abbrev})` : ''}.` };
  }
  if (amount < target * 0.8) {
    info.stiff = Math.min(1.15, (info.stiff ?? 1) * 1.04);
    return { ok: false, text: `${pname(p)}'s trainer called the offer insulting. His price went up.` };
  }
  return { ok: false, text: `${pname(p)} turned it down${amount >= target * 0.97 ? ', but it was close' : ''}.` };
}

export function signIfa(league: League, orgId: number, p: Player, amount = p.ifa?.asking ?? 10_000): string | null {
  if (!isIfa(p)) return 'Not available';
  const bonus = roundSalary(amount);
  const posted = p.ifa!.posted;
  league.intl.spent[orgId] = (league.intl.spent[orgId] ?? 0) + bonus;
  p.orgId = orgId;
  touchRosters();
  p.teamSince = league.season;
  p.level = posted ? 'AAA' : 'DSL';
  p.signAge = league.season - p.born + (league.phase === 'offseason' ? 1 : 0);
  // Signed in the winter: his first pro season is next season.
  if (!posted) p.proSeasons = league.phase === 'offseason' ? -1 : 0;
  milbContract(p, league.season, p.level);
  p.contract.bonus = bonus;
  delete p.ifa;
  const what = posted ? `posted ${posted} player` : 'international amateur';
  addTransaction(league, orgId, 'Sign', `Signed ${what} ${p.pos} ${pname(p)} (${p.country}) for a ${fmtMoney(bonus)} bonus`, [p.id]);
  logMove(league, 'International', [side(orgId, [p.id])], `${league.orgs[orgId].abbrev} signed ${p.pos} ${pname(p)} (${p.country})`, bonus);
  if (posted) addNews(league, null, `${pname(p)}, posted by his ${posted} club, signed a minor league deal with the ${league.orgs[orgId].affiliates.MLB.name} (${fmtMoney(bonus)} bonus).`, [p.id]);
  return null;
}

// ---------- AI clubs ----------

function ifaSd(league: League, org: Org): number {
  const fd = staffOf(league, org, 'FD');
  return (fd ? Math.max(1, ((80 - fd.evaluation) / 60) * 5) : 5) * scoutFactor(league, org, 'intl');
}

// Each club works its board once a week (clubs are spread across the week).
function aiRound(league: League, org: Org): void {
  const left = poolLeft(league, org.id);
  if (left < 10_000) return;
  const sd = ifaSd(league, org);
  const cands = Object.values(league.players)
    .filter((p) => isIfa(p) && p.ifa!.verbal?.orgId !== org.id && !canOfferIfa(league, org.id, p))
    .map((p) => {
      const est = askingRange(league, p, org.id).mid;
      const v = 0.8 * potOvr(p) + 0.2 * ovr(p) + sd * seededNormal(p.scoutSeed, org.id, 99);
      return { p, est, v: v - est / 1_000_000 };
    })
    .filter((x) => x.est <= left)
    .sort((a, b) => b.v - a.v);
  // Interest: the clubs tracking a player show up as bidders even before offering.
  for (const c of cands.slice(0, 6)) {
    c.p.ifa!.bids ??= {};
    c.p.ifa!.bids[org.id] ??= 0;
  }
  let room = left;
  let made = 0;
  for (const { p, est } of cands) {
    if (made >= 3) break;
    const info = p.ifa!;
    // Poaching a verbal needs a clearly bigger offer; clubs rarely try.
    if (info.verbal && rand() > 0.15) continue;
    const want = Math.max(est, info.verbal ? info.verbal.amount * 1.15 : 0, (info.lastOffer?.[org.id] !== undefined ? (info.bids?.[org.id] ?? 0) * 1.06 : 0));
    const offer = roundSalary(Math.min(room, want * (0.97 + rand() * 0.11)));
    if (offer < want * 0.85) continue;
    const r = offerIfa(league, org.id, p, offer);
    made++;
    if (r.ok) room = poolLeft(league, org.id);
  }
}

// Jan 1: late reports and the market shake things up.
export function negotiationDay(league: League): void {
  let broke = 0;
  for (const p of Object.values(league.players)) {
    if (!isIfa(p)) continue;
    const info = p.ifa!;
    if (rand() < 0.35) info.asking = roundSalary(Math.max(10_000, info.asking * Math.exp(normal(0, 0.18))));
    const v = info.verbal;
    if (!v) continue;
    // A richer club swoops in, or his price jumped past the deal.
    const swoop = rand() < 0.08 ? league.orgs.find((o) => o.id !== v.orgId && o.id !== league.userOrgId && delegated(league, o, 'ifa') && poolLeft(league, o.id) >= v.amount * 1.2) : undefined;
    if (swoop) {
      const amt = roundSalary(v.amount * (1.2 + rand() * 0.15));
      info.bids ??= {};
      info.bids[swoop.id] = amt;
      if (v.orgId === league.userOrgId) ifaLostNotice(league, p, swoop.id, amt, true, 'Negotiation day: ');
      info.verbal = { orgId: swoop.id, amount: amt, day: league.day };
      broke++;
      addNews(league, v.orgId === league.userOrgId ? v.orgId : null, `Negotiation day: ${pname(p)} backed out of his agreement with the ${league.orgs[v.orgId].affiliates.MLB.name} and will sign with the ${swoop.affiliates.MLB.name} for ${fmtMoney(amt)}.`, [p.id]);
    } else if (info.asking > v.amount * 1.3 && rand() < 0.3) {
      info.verbal = null;
      broke++;
      if (v.orgId === league.userOrgId) addInbox(league, { from: 'International scouting', kind: 'info', pids: [p.id], stop: true, link: { page: 'international' }, subject: `${pname(p)} backed out of his deal with you`, text: `Negotiation day: after a strong late showcase, ${p.pos} ${pname(p)} (${p.country}) backed out of his ${fmtMoney(v.amount)} agreement with you. He's back on the market, now asking more.` });
      addNews(league, v.orgId === league.userOrgId ? v.orgId : null, `Negotiation day: after a strong late showcase, ${pname(p)} backed out of his ${fmtMoney(v.amount)} agreement with the ${league.orgs[v.orgId].affiliates.MLB.name}. He's back on the market.`, [p.id]);
    }
  }
  addNews(league, null, `International negotiation day: late scouting reports moved prices${broke ? `; ${broke} verbal agreement${broke === 1 ? '' : 's'} fell apart` : ''}.`);
}

// Daily: clubs negotiate (once a week each); after signing day, prices fall.
export function ifaDay(league: League): void {
  const phase = ifaPhase(league);
  if (phase === 'closed') return;
  if (phase === 'open' && league.day % 7 === 0) {
    for (const p of Object.values(league.players)) if (isIfa(p)) p.ifa!.asking = roundSalary(Math.max(10_000, p.ifa!.asking * 0.97));
  }
  if (!Object.values(league.players).some(isIfa)) return;
  for (const org of league.orgs) {
    if (!delegated(league, org, 'ifa')) continue;
    if ((league.day + org.id) % 7 !== 0) continue;
    if (phase === 'open' && league.phase === 'regular' && rand() < 0.5) continue;
    aiRound(league, org);
  }
}

// ---------- posted pros ----------

const POST_LEAGUE: Record<string, string> = { Japan: 'NPB', 'South Korea': 'KBO', Taiwan: 'CPBL' };

// MLB posting fee: 20% of the first $25M, 17.5% of the next $25M, 15% beyond.
export function postingFee(total: number): number {
  return 0.2 * Math.min(total, 25e6) + 0.175 * clamp(total - 25e6, 0, 25e6) + 0.15 * Math.max(0, total - 50e6);
}

export function postPlayers(league: League): void {
  const n = randInt(3, 6);
  const names: string[] = [];
  for (let i = 0; i < n; i++) {
    const star = rand() < 0.2;
    const young = rand() < (star ? 0.35 : 0.15);
    const age = young ? randInt(21, 24) : randInt(25, 31);
    const code = rand() < 0.6 ? 'JPN' : rand() < 0.75 ? 'KOR' : 'TWN';
    let p: Player | null = null;
    for (let k = 0; k < 6; k++) {
      p = generatePlayer({ id: league.nextId.player, season: league.season + 1, level: 'MLB', orgId: null, age, talentShift: star ? 9 : young ? 1 : 0 });
      const o = ovr(p);
      if (o >= (star ? 58 : 45) && o <= 74) break;
    }
    if (!p) continue;
    league.nextId.player++;
    const origin = originFrom(code);
    p.country = origin.country;
    p.first = origin.first;
    p.last = origin.last;
    p.proSeasons = age - 18;
    league.players[p.id] = p;
    const from = POST_LEAGUE[p.country] ?? 'NPB';
    if (age < 25) {
      // Under 25: an international amateur under MLB rules, paid from the pool.
      p.level = null;
      p.orgId = null;
      milbContract(p, league.season + 1, 'AAA');
      const ask = roundSalary(clamp(1.5e6 + (ovr(p) - 50) * 0.35e6, 1e6, 6.5e6));
      p.ifa = { year: league.season + 1, asking: ask, posted: from } satisfies IfaInfo;
    } else {
      openFreeAgent(league, p, null);
      p.fa!.posted = { from, deadline: league.day + 45 };
      p.fa!.decideDay = Math.min(p.fa!.decideDay, league.day + 40);
    }
    names.push(`${p.pos} ${pname(p)} (${from}${age < 25 ? ', pool-eligible' : ''})`);
  }
  addNews(league, null, `Posted from Asia this winter: ${names.join(', ')}. Players 25 and older have 45 days to sign as free agents (their old club gets a posting fee); younger players sign out of international bonus pools.`);
}

// Posted free agents who don't sign by the deadline go back to their club.
export function postingDeadlines(league: League): void {
  for (const p of Object.values(league.players)) {
    const post = p.fa?.posted;
    if (!post || p.orgId !== null || league.day < post.deadline) continue;
    addNews(league, null, `${pname(p)} did not sign before his posting deadline and returns to his ${post.from} club.`, [p.id]);
    delete league.players[p.id];
  }
  touchRosters();
}
