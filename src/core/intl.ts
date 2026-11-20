// International amateur free agency: bonus pools by market, a class of
// 16-17 year olds, and a signing period that opens January 15.
import type { League, Player } from './types.ts';
import { generatePlayer } from './playerGen.ts';
import { normal, rand, seededNormal } from './random.ts';
import { ovr, potOvr, scoutFactor } from './ratings.ts';
import { milbContract, roundSalary } from './contracts.ts';
import { addNews, addTransaction, pname, touchRosters } from './util.ts';
import { delegated, staffOf } from './staff.ts';
import { logMove, side } from './moves.ts';

export function poolFor(market: number): number {
  return market < 0.8 ? 7_555_500 : market <= 1.1 ? 6_908_600 : 6_261_600;
}

export const isIfa = (p: Player) => !!p.ifa && p.orgId === null;

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

export function openIfaPeriod(league: League): void {
  league.intl = { pools: {}, spent: {}, open: true, acquired: {}, base: {} };
  for (const o of league.orgs) {
    const base = poolFor(o.market);
    const pen = league.ifaPenalty[o.id] ?? 0;
    league.intl.base![o.id] = base;
    league.intl.pools[o.id] = Math.max(0, base - pen);
    league.intl.spent[o.id] = 0;
    league.intl.acquired![o.id] = 0;
    if (pen && o.id === league.userOrgId) addNews(league, o.id, `Your international bonus pool is reduced by $${(pen / 1e6).toFixed(2)}M (qualifying-offer penalty).`);
  }
  league.ifaPenalty = {};
}

export function canSignIfa(league: League, orgId: number, p: Player): string | null {
  if (!league.intl.open) return 'The signing period is not open';
  if (!isIfa(p)) return 'Not available';
  const left = (league.intl.pools[orgId] ?? 0) - (league.intl.spent[orgId] ?? 0);
  if (p.ifa!.asking > left) return 'Not enough bonus pool left';
  return null;
}

export function signIfa(league: League, orgId: number, p: Player): string | null {
  const why = canSignIfa(league, orgId, p);
  if (why) return why;
  const bonus = p.ifa!.asking;
  league.intl.spent[orgId] = (league.intl.spent[orgId] ?? 0) + bonus;
  p.orgId = orgId;
  touchRosters();
  p.teamSince = league.season;
  p.level = 'DSL';
  p.signAge = league.season - p.born + (league.phase === 'offseason' ? 1 : 0);
  // Signed in the winter: his first pro season is next season.
  p.proSeasons = league.phase === 'offseason' ? -1 : 0;
  milbContract(p, league.season, 'DSL');
  p.contract.bonus = bonus;
  delete p.ifa;
  addTransaction(league, orgId, 'Sign', `Signed international amateur ${p.pos} ${pname(p)} (${p.country}) for a $${(bonus / 1e6).toFixed(2)}M bonus`, [p.id]);
  logMove(league, 'International', [side(orgId, [p.id])], `${league.orgs[orgId].abbrev} signed ${p.pos} ${pname(p)} (${p.country})`, bonus);
  return null;
}

// AI clubs (and a delegated assistant GM) spend their pools over the first weeks.
export function ifaDay(league: League): void {
  if (!league.intl.open) return;
  if (league.phase === 'regular' && league.day % 7 !== 0) return;
  const avail = Object.values(league.players).filter(isIfa);
  if (!avail.length) return;
  for (const org of league.orgs) {
    if (!delegated(league, org, 'ifa')) continue;
    if (rand() > 0.35) continue;
    const fd = staffOf(league, org, 'FD');
    const sd = (fd ? Math.max(1, ((80 - fd.evaluation) / 60) * 5) : 5) * scoutFactor(league, org, 'intl');
    const left = league.intl.pools[org.id] - league.intl.spent[org.id];
    const cands = avail
      .filter((p) => isIfa(p) && p.ifa!.asking <= left)
      .map((p) => ({ p, v: 0.8 * potOvr(p) + 0.2 * ovr(p) + sd * seededNormal(p.scoutSeed, org.id, 99) - p.ifa!.asking / 1_000_000 }))
      .sort((a, b) => b.v - a.v);
    const take = cands.slice(0, org.id === league.userOrgId ? 3 : 2);
    for (const { p } of take) signIfa(league, org.id, p);
  }
}
