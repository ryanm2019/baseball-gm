// A permanent log of player acquisitions, used to judge moves years later.
import type { League, Move, MoveSide, MoveType, Player } from './types.ts';
import { dayLabel } from './settings.ts';
import { fmtMoney } from './contracts.ts';
import { pname } from './util.ts';

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

// How a player came to his current club, from the move log (and the transaction
// log for signings the move log doesn't keep). `short` fits a table cell.
export function acquisition(league: League, p: Player): { short: string; text: string } | null {
  if (p.orgId === null) return null;
  const org = league.orgs[p.orgId];
  const m = (league.moves ?? []).filter((x) => x.type !== 'Extension' && x.sides.some((s) => s.orgId === p.orgId && s.gets.includes(p.id))).at(-1);
  const name = (id: number) => { const q = league.players[id]; return q ? pname(q) : 'a player'; };
  if (m) {
    const when = dayLabel(m.season, m.day);
    const from = m.sides.find((s) => s.orgId !== p.orgId);
    const fromOrg = from ? league.orgs[from.orgId] : null;
    switch (m.type) {
      case 'Draft': {
        const d = p.draft && p.draft.orgId === p.orgId ? p.draft : null;
        return { short: d ? `Draft '${String(d.year).slice(2)} R${d.round}` : 'Draft', text: `Drafted${d ? ` in round ${d.round} (#${d.pick} overall) of the ${d.year} draft` : ''}; signed ${when} for a ${fmtMoney(m.cost)} bonus.` };
      }
      case 'International':
        return { short: `Intl '${String(m.start).slice(2)}`, text: `Signed as an international amateur (${p.country}) on ${when} for a ${fmtMoney(m.cost)} bonus.` };
      case 'Free agent':
        return { short: `FA '${String(m.start).slice(2)}`, text: `Signed as a free agent on ${when}: ${m.text.replace(/^\w+ signed [^:]*: /, '')}${m.cost ? ` (${fmtMoney(m.cost)} guaranteed)` : ''}.` };
      case 'Trade': {
        const gave = from ? [...from.gets.map(name), ...(from.cash ? [`${fmtMoney(from.cash)} cash`] : []), ...from.picks] : [];
        return { short: `Trade '${String(m.start).slice(2)}`, text: `Acquired from the ${fromOrg?.affiliates.MLB.name ?? 'another club'} on ${when}${gave.length ? ` for ${gave.join(', ')}` : ''}.` };
      }
      case 'Waiver claim':
        return { short: 'Waivers', text: `Claimed off waivers from the ${fromOrg?.affiliates.MLB.name ?? 'another club'} on ${when}.` };
      case 'Rule 5':
        return { short: 'Rule 5', text: `Taken from the ${fromOrg?.affiliates.MLB.name ?? 'another club'} in the Rule 5 draft (${when}).` };
    }
  }
  // Signings the move log doesn't record (minor league deals and the like).
  const t = league.transactions.filter((x) => x.orgId === p.orgId && x.pids.includes(p.id) && /^Sign|Claim/.test(x.type)).at(-1);
  if (t) return { short: 'Signed', text: `${t.text} (${dayLabel(t.season, t.day)}).` };
  if (p.draft && p.draft.orgId === p.orgId) return { short: `Draft '${String(p.draft.year).slice(2)} R${p.draft.round}`, text: `Drafted in round ${p.draft.round} (#${p.draft.pick} overall) of the ${p.draft.year} draft.` };
  return { short: 'Original', text: `With the ${org.affiliates.MLB.name} since before this league began.` };
}
