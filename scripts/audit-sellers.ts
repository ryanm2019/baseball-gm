// How often selling clubs act like buyers: acquire veterans/rentals, or give up
// prospects for big leaguers. Also counts offers to the user from sellers.
//   node --experimental-strip-types scripts/audit-sellers.ts
// Same league every run (seed from argv), so before/after comparisons are fair.
let seed = Number(process.argv[2] ?? 7) >>> 0;
Math.random = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
import { serviceYears } from '../src/core/contracts.ts';
import { createLeague } from '../src/core/league.ts';
import { simOneDay } from '../src/core/sim/day.ts';
import { advanceDraft } from '../src/core/draft.ts';
import { ovr, potOvr } from '../src/core/ratings.ts';
import { aiAccepts, emptyAssets, tradable } from '../src/core/trade.ts';
import { shopPlayer } from '../src/core/tradeFinder.ts';
import type { League, Player } from '../src/core/types.ts';

const L: League = createLeague({ name: 'sellers', userOrgIndex: 3, season: 2027 });
const U = L.orgs[3];
for (const k of Object.keys(U.agm)) (U.agm as Record<string, boolean>)[k] = true;
(U.agm as Record<string, boolean>).trades = false;
// A veteran: 29+, or headed for free agency after this season (6+ years of service by then).
const vet = (p: Player) => p.level === 'MLB' && (L.season - p.born >= 29 || (p.contract.type === 'ML' && p.contract.exp <= L.season && serviceYears(p.mlServiceDays, L.settings) >= 5));
const prospect = (p: Player) => p.level !== 'MLB' && potOvr(p) >= 50 && L.season - p.born <= 25;
const seen = new Set<number>(), seenMsg = new Set<number>();
const c = { trades: 0, sellerTrades: 0, sellerGetsVet: 0, sellerGivesProspectForMlb: 0, buyerGetsProspectsForVet: 0, dumpsToSellers: 0, offersToUser: 0, offersFromSellersForVets: 0 };
const ex: string[] = [];
let g = 0;
while (L.season === 2027 && g++ < 600) {
  const r = simOneDay(L);
  if (r.stop?.includes('clock')) advanceDraft(L, true);
  if (L.phase !== 'regular') { if (L.phase === 'offseason') break; continue; }
  if (L.day === L.settings.tradeDeadlineDay - 5) probe();
  for (const m of L.moves) {
    if (m.type !== 'Trade' || seen.has(m.id)) continue;
    seen.add(m.id); c.trades++;
    for (let i = 0; i < m.sides.length; i++) {
      const s = m.sides[i], o = m.sides[1 - i];
      const org = L.orgs[s.orgId];
      if (org.stance !== 'Selling') continue;
      c.sellerTrades++;
      const gets = s.gets.map((id) => L.players[id]).filter(Boolean);
      const gives = (o?.gets ?? []).map((id) => L.players[id]).filter(Boolean);
      if (gets.some(vet)) { c.sellerGetsVet++; if (s.cash > 0) c.dumpsToSellers++; if (ex.length < 6) ex.push(`${L.day} ${org.abbrev} (selling, ${org.strategy}) gets ${gets.map((p) => `${p.last} ${L.season - p.born}y ${p.level} thru ${p.contract.exp}`).join(', ')} for ${gives.map((p) => `${p.last} ${p.level} pot ${potOvr(p).toFixed(0)}`).join(', ')}${s.cash ? ` + $${(s.cash / 1e6).toFixed(1)}M` : ''}`); }
      if (gives.some(prospect) && gets.some((p) => p.level === 'MLB')) c.sellerGivesProspectForMlb++;
    }
  }
  for (const o of L.tradeOffers) {
    if (seenMsg.has(o.id)) continue;
    seenMsg.add(o.id); c.offersToUser++;
    const from = L.orgs[o.fromOrg];
    const want = o.proposal.give[o.proposal.orgs[0] === U.id ? 0 : 1].pids.map((id) => L.players[id]);
    if (from.stance === 'Selling' && want.some(vet)) { c.offersFromSellersForVets++; if (ex.length < 9) ex.push(`offer to you: ${from.abbrev} (selling) wants ${want.map((p) => `${p.last} ${L.season - p.born}y thru ${p.contract.exp}`).join(', ')}`); }
  }
}
function probe() {
  // The user's veterans / rentals: who in Trade Finder makes an offer, and will a
  // seller hand over its best prospect for one?
  const vets = tradable(L, U.id).filter(vet).sort((a, b) => ovr(b) - ovr(a)).slice(0, 6);
  let offers = 0, fromSellers = 0, sellerYes = 0, sellerTries = 0;
  const sellers = L.orgs.filter((o) => o.id !== U.id && o.stance === 'Selling');
  for (const v of vets) {
    console.log(`  ${v.last} ${L.season - v.born}y ${ovr(v).toFixed(0)} service ${serviceYears(v.mlServiceDays, L.settings)} contract thru ${v.contract.exp} $${(v.contract.salary / 1e6).toFixed(1)}M`);
    for (const d of shopPlayer(L, v.id, 'best')) { offers++; if (L.orgs[d.prop.orgs[1]].stance === 'Selling') { fromSellers++; if (fromSellers <= 4) console.log(`    selling ${L.orgs[d.prop.orgs[1]].abbrev} offers ${d.prop.give[1].pids.map((id) => { const q = L.players[id]; return `${q.last} ${q.level} ${L.season - q.born}y ${ovr(q).toFixed(0)}/${potOvr(q).toFixed(0)}`; }).join(' + ')}`); } }
    for (const so of sellers) {
      const top = tradable(L, so.id).filter(prospect).sort((a, b) => potOvr(b) - potOvr(a))[0];
      if (!top) continue;
      sellerTries++;
      if (aiAccepts(L, so, { orgs: [U.id, so.id], give: [{ ...emptyAssets(), pids: [v.id] }, { ...emptyAssets(), pids: [top.id] }] })) { sellerYes++; if (ex.length < 12) ex.push(`seller ${so.abbrev} gives ${top.last} (${top.level} ${ovr(top).toFixed(0)}/${potOvr(top).toFixed(0)}) for your ${v.last} ${L.season - v.born}y ${ovr(v).toFixed(0)} thru ${v.contract.exp}`); }
    }
  }
  console.log(`Deadline probe: ${vets.length} of your veterans; Trade Finder offers ${offers}, ${fromSellers} from selling clubs; sellers giving their top prospect for one: ${sellerYes}/${sellerTries}; selling clubs ${sellers.length}`);
}
console.log(c);
console.log(ex.join('\n'));
