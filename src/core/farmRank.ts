// Farm system rankings, the way the industry publishes them (think MLB
// Pipeline / Baseball America): every club's rookie-eligible prospects get a
// future value grade, the top 100 is ranked, and organizations are scored by
// the talent in their systems. Editions come out in spring and after the trade
// deadline; a live view is always available. The industry's grades are a
// consensus (close to the truth, not exact); your own scouts' reads sit beside them.
import type { League, Player } from './types.ts';
import { ovr, potOvr } from './ratings.ts';
import { addNews, orgPlayers, pname } from './util.ts';
import { addInbox } from './morale.ts';
import { posLabel } from './rules.ts';

export interface RankedProspect { pid: number; orgId: number; rank: number; fv: number; eta: number }
export interface RankedOrg { orgId: number; rank: number; score: number; top100: number; fv50: number; best: number | null }
export interface FarmEdition { season: number; label: 'Preseason' | 'Midseason'; day: number; orgs: RankedOrg[]; top100: RankedProspect[] }

// Rookie eligible: fewer than 130 MLB at-bats, 50 MLB innings and 45 days on the active roster.
export function rookieEligible(p: Player): boolean {
  if (p.orgId === null || p.retired) return false;
  let ab = 0, outs = 0;
  for (const s of p.stats) if (s.level === 'MLB') { ab += s.bat.ab; outs += s.pit.outs; }
  return ab < 130 && outs < 150 && p.mlServiceDays < 45;
}

// The industry's consensus: close to the truth with a little disagreement that
// changes between editions.
function consensusNoise(pid: number, key: number): number {
  let h = (Math.imul(pid ^ 0x51ed27, 2654435761) ^ Math.imul(key, 97531)) >>> 0;
  let t = 0;
  for (let i = 0; i < 3; i++) { h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0; t += h / 4294967296; }
  return (t - 1.5) * 2; // about normal, sd 1
}

// Future value on the 20-80 scale, in steps of 5 (with 45+ and 55+ as in the publications).
export function industryFv(league: League, p: Player, key = league.season * 2): number {
  const age = league.season - p.born;
  const pot = potOvr(p) + consensusNoise(p.id, key) * 2.5;
  const now = ovr(p);
  // Potential is a ceiling; the grade is what he's expected to become. Closer to
  // the majors, more of the gap is likely to close.
  const realize: Record<string, number> = { MLB: 0.8, AAA: 0.75, AA: 0.66, 'A+': 0.6, A: 0.56, CPX: 0.52, DSL: 0.5 };
  const r = (realize[p.level ?? 'A'] ?? 0.56) + (age <= 19 ? 0.03 : 0) - (age >= 25 ? 0.08 : 0);
  // (Calibrated so the No. 1 prospect grades about 70-75 and No. 100 about 55, like the real lists.)
  const fv = now + Math.max(0, pot - now) * r - 3;
  return Math.max(35, Math.round(fv / 2.5) * 2.5);
}

export const fvLabel = (fv: number) => (fv % 5 === 0 ? String(fv) : `${Math.floor(fv / 5) * 5}+`);

// Points a prospect adds to his system's score (top-heavy, like the real rankings).
const POINTS = (fv: number) => (fv >= 70 ? 40 : fv >= 65 ? 26 : fv >= 60 ? 15 : fv >= 55 ? 8 : fv >= 50 ? 4 : fv >= 45 ? 1.5 : 0.3);

// When he's expected in the big leagues.
export function eta(league: League, p: Player): number {
  const steps: Record<string, number> = { MLB: 0, AAA: 0, AA: 1, 'A+': 1, A: 2, CPX: 3, DSL: 4 };
  return league.season + (steps[p.level ?? 'A'] ?? 2) + (potOvr(p) - ovr(p) > 20 ? 1 : 0);
}

// The rankings as of today.
export function liveRankings(league: League, key = league.season * 2): { orgs: RankedOrg[]; top100: RankedProspect[]; fv: Map<number, number> } {
  const fv = new Map<number, number>();
  const all: { p: Player; fv: number }[] = [];
  for (const org of league.orgs) {
    for (const p of orgPlayers(league, org.id)) {
      if (!rookieEligible(p)) continue;
      const v = industryFv(league, p, key);
      fv.set(p.id, v);
      all.push({ p, fv: v });
    }
  }
  all.sort((a, b) => b.fv - a.fv || potOvr(b.p) - potOvr(a.p) || ovr(b.p) - ovr(a.p));
  const top100: RankedProspect[] = all.slice(0, 100).map((x, i) => ({ pid: x.p.id, orgId: x.p.orgId!, rank: i + 1, fv: x.fv, eta: eta(league, x.p) }));
  const orgs: RankedOrg[] = league.orgs.map((o) => {
    const mine = all.filter((x) => x.p.orgId === o.id).slice(0, 30);
    return {
      orgId: o.id, rank: 0,
      score: Math.round(mine.reduce((t, x) => t + POINTS(x.fv), 0) * 10) / 10,
      top100: top100.filter((r) => r.orgId === o.id).length,
      fv50: mine.filter((x) => x.fv >= 50).length,
      best: mine[0]?.p.id ?? null,
    };
  });
  orgs.sort((a, b) => b.score - a.score);
  orgs.forEach((o, i) => { o.rank = i + 1; });
  return { orgs, top100, fv };
}

export function editions(league: League): FarmEdition[] {
  league.farmRankings ??= [];
  return league.farmRankings;
}

// Publish an edition (spring, and after the deadline) with a note on your system.
export function publishFarmRankings(league: League, label: FarmEdition['label']): void {
  const eds = editions(league);
  if (eds.some((e) => e.season === league.season && e.label === label)) return;
  const live = liveRankings(league, league.season * 2 + (label === 'Midseason' ? 1 : 0));
  const prev = eds[eds.length - 1];
  const ed: FarmEdition = { season: league.season, label, day: league.day, orgs: live.orgs, top100: live.top100 };
  eds.push(ed);
  if (eds.length > 8) eds.splice(0, eds.length - 8);
  const top = ed.orgs[0];
  const no1 = league.players[ed.top100[0]?.pid];
  addNews(league, null, `${label} farm system rankings: the ${league.orgs[top.orgId].affiliates.MLB.name} have the game's best system. No. 1 prospect: ${no1 ? `${posLabel(no1)} ${pname(no1)} (${league.orgs[no1.orgId!].abbrev})` : 'n/a'}.`);
  const me = ed.orgs.find((o) => o.orgId === league.userOrgId)!;
  const was = prev?.orgs.find((o) => o.orgId === league.userOrgId)?.rank;
  const moved = was ? (was > me.rank ? `, up ${was - me.rank} from No. ${was}` : was < me.rank ? `, down ${me.rank - was} from No. ${was}` : ', unchanged') : '';
  const mine = ed.top100.filter((r) => r.orgId === league.userOrgId);
  addInbox(league, {
    from: 'Front office', subject: `${label} farm rankings: your system is No. ${me.rank}`, kind: 'info', pids: mine.slice(0, 5).map((r) => r.pid), link: { page: 'farm-rankings' },
    text: `The ${label.toLowerCase()} farm system rankings are out: yours ranks No. ${me.rank} of ${ed.orgs.length}${moved}. ${mine.length ? `You have ${mine.length} of the top 100: ${mine.slice(0, 5).map((r) => `No. ${r.rank} ${pname(league.players[r.pid])}`).join(', ')}${mine.length > 5 ? ', …' : ''}.` : 'None of your prospects made the top 100.'}`,
  });
}

// Daily: spring edition around March 1, midseason the day after the deadline.
export function farmRankingsDay(league: League): void {
  const eds = editions(league);
  const has = (label: FarmEdition['label']) => eds.some((e) => e.season === league.season && e.label === label);
  if (league.phase === 'preseason' && league.day >= -25 && !has('Preseason')) publishFarmRankings(league, 'Preseason');
  if (league.phase === 'regular' && league.day > league.settings.tradeDeadlineDay && !has('Midseason')) publishFarmRankings(league, 'Midseason');
}
