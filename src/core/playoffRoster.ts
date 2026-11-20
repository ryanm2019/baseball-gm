// Postseason rosters: 26 players for each round (no more than 13 pitchers),
// from players in the organization by August 31 (40-man or active roster).
// AI clubs and your assistant GM pick automatically; otherwise the sim pauses
// before each round so you can set yours. Injured players can be swapped out.
import type { League, Player } from './types.ts';
import { isPitcher, ovr } from './ratings.ts';
import { orgPlayers } from './util.ts';
import { postseasonEligible } from './sim/lineup.ts';
import { delegated } from './staff.ts';

export const PO_SIZE = 26;
export const PO_MAX_P = 13;

export function roundOf(league: League, orgId: number): string | null {
  const sr = league.playoffs?.series.find((s) => s.winner === null && (s.high === orgId || s.low === orgId));
  return sr ? sr.round : null;
}

export function playoffCandidates(league: League, orgId: number): Player[] {
  return orgPlayers(league, orgId).filter((p) => (p.on40 || p.level === 'MLB') && postseasonEligible(league, p) && !p.retired);
}

// Best 26: 13 pitchers (rotation and best arms), at least two catchers, best bats.
export function autoPlayoffRoster(league: League, orgId: number): number[] {
  const c = playoffCandidates(league, orgId).filter((p) => !p.injury);
  const pitchers = c.filter(isPitcher).sort((a, b) => ovr(b) - ovr(a)).slice(0, PO_MAX_P);
  const hitters = c.filter((p) => !isPitcher(p)).sort((a, b) => ovr(b) - ovr(a));
  const cs = hitters.filter((p) => p.pos === 'C').slice(0, 2);
  const rest = hitters.filter((p) => !cs.includes(p)).slice(0, PO_SIZE - pitchers.length - cs.length);
  return [...pitchers, ...cs, ...rest].map((p) => p.id);
}

export function validatePlayoffRoster(league: League, orgId: number, ids: number[]): string | null {
  const ps = ids.map((id) => league.players[id]).filter(Boolean);
  if (ps.length !== PO_SIZE) return `Pick exactly ${PO_SIZE} players (${ps.length} selected)`;
  if (ps.filter(isPitcher).length > PO_MAX_P) return `No more than ${PO_MAX_P} pitchers`;
  const ok = new Set(playoffCandidates(league, orgId).map((p) => p.id));
  const bad = ps.find((p) => !ok.has(p.id));
  return bad ? `${bad.first} ${bad.last} isn't eligible (joined after August 31 or not on the 40-man)` : null;
}

// Before each day's games: every club in a series has a roster for its round.
// Returns a stop message the first time your club needs one (unless delegated).
export function ensurePlayoffRosters(league: League): string | null {
  const po = league.playoffs;
  if (!po) return null;
  po.rosters ??= {};
  let stop: string | null = null;
  for (const org of league.orgs) {
    const round = roundOf(league, org.id);
    if (!round) continue;
    const key = `${round}:${org.id}`;
    if (po.rosters[key]) {
      // Injured players are replaced automatically for AI clubs.
      if (org.id !== league.userOrgId || delegated(league, org, 'roster')) {
        const ids = po.rosters[key];
        if (ids.some((id) => league.players[id]?.injury)) po.rosters[key] = autoPlayoffRoster(league, org.id);
      }
      continue;
    }
    po.rosters[key] = autoPlayoffRoster(league, org.id);
    if (org.id === league.userOrgId && !delegated(league, org, 'roster')) {
      stop = `Playoff roster: set your 26 for the ${({ WC: 'Wild Card Series', DS: 'Division Series', CS: 'League Championship Series', WS: 'World Series' } as Record<string, string>)[round]} on the Playoff Roster page (your assistant pre-filled it). Press Play when you're ready.`;
    }
  }
  return stop;
}

export function playoffRosterFor(league: League, orgId: number): Set<number> | null {
  const round = roundOf(league, orgId);
  const ids = round ? league.playoffs?.rosters?.[`${round}:${orgId}`] : undefined;
  if (!ids) return null;
  return new Set(validatePlayoffRoster(league, orgId, ids) ? autoPlayoffRoster(league, orgId) : ids);
}
