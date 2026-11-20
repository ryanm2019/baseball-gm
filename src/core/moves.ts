// A permanent log of player acquisitions, used to judge moves years later.
import type { League, Move, MoveSide, MoveType } from './types.ts';

export function moveStartSeason(league: League): number {
  return league.phase === 'offseason' ? league.season + 1 : league.season;
}

export const side = (orgId: number, gets: number[], extra: Partial<MoveSide> = {}): MoveSide => ({
  orgId, gets, cash: 0, pool: 0, picks: [], ...extra,
});

export function logMove(league: League, type: MoveType, sides: MoveSide[], text: string, cost = 0): void {
  league.moves ??= [];
  const m: Move = { id: league.nextId.tx++, season: league.season, day: league.day, start: moveStartSeason(league), type, sides, text, cost };
  league.moves.push(m);
}
