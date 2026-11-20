// Roster actions available to the user for one of their players.
import type { League, Level, Player } from '../core/types.ts';
import { MINOR_LEVELS } from '../core/types.ts';
import {
  activateFromIL,
  addTo40,
  assignPlayer,
  canActivate,
  canAdd40,
  canAssign,
  canDfa,
  canOption,
  canPlaceIL,
  canRecall,
  canSelect,
  designate,
  optionPlayer,
  placeIL,
  placeOnWaivers,
  recallPlayer,
  releasePlayer,
  selectContract,
} from '../core/rules.ts';
import { activeAt } from '../core/util.ts';

export interface Action {
  key: string;
  label: string;
  reason: string | null;
  confirm?: string;
  run: () => void;
}

function injuredOnMlb(league: League, orgId: number): boolean {
  // A recall that replaces a player placed on the IL today is exempt from the minimum stay.
  return league.transactions.some((t) => t.orgId === orgId && t.day === league.day && t.season === league.season && t.type === 'IL');
}

export function playerActions(league: League, p: Player): Action[] {
  if (p.orgId !== league.userOrgId) return [];
  const out: Action[] = [];
  const org = league.orgs[p.orgId];
  const affName = (l: Level) => `${l} ${org.affiliates[l].name}`;

  if (p.il) {
    out.push({ key: 'activate', label: 'Activate from IL', reason: canActivate(league, p), run: () => activateFromIL(league, p) });
    return out;
  }
  if (p.dfa) {
    out.push({ key: 'waive', label: 'Place on outright waivers', reason: null, run: () => placeOnWaivers(league, p, 'outright') });
    out.push({ key: 'release', label: 'Release', reason: null, confirm: `Release ${p.first} ${p.last}? Remaining salary is still owed.`, run: () => releasePlayer(league, p) });
    return out;
  }
  if (p.waivers) return out;

  if (p.level === 'MLB') {
    for (const l of ['AAA', 'AA'] as Level[]) {
      out.push({ key: `option-${l}`, label: `Option to ${affName(l)}`, reason: canOption(league, p), run: () => optionPlayer(league, p, l) });
    }
  } else if (p.on40) {
    const exempt = injuredOnMlb(league, p.orgId);
    out.push({ key: 'recall', label: 'Recall to MLB', reason: canRecall(league, p, exempt), run: () => recallPlayer(league, p) });
  } else {
    out.push({ key: 'select', label: 'Select contract (add to 40 + MLB)', reason: canSelect(league, p), run: () => selectContract(league, p) });
    out.push({ key: 'add40', label: 'Add to 40-man (stay in minors)', reason: canAdd40(league, p), run: () => addTo40(league, p) });
  }
  if (p.level !== 'MLB') {
    for (const l of MINOR_LEVELS) {
      if (l === p.level) continue;
      out.push({ key: `assign-${l}`, label: `Assign to ${affName(l)}`, reason: canAssign(league, p, l), run: () => assignPlayer(league, p, l) });
    }
  }
  out.push({ key: 'il', label: 'Place on injured list', reason: canPlaceIL(league, p), run: () => placeIL(league, p) });
  if (p.on40) {
    out.push({
      key: 'dfa',
      label: 'Designate for assignment',
      reason: canDfa(league, p),
      confirm: `Designate ${p.first} ${p.last} for assignment? He comes off the 40-man roster now and goes to waivers within ${league.settings.dfaDays} days.`,
      run: () => designate(league, p),
    });
  }
  out.push({
    key: 'release',
    label: 'Release',
    reason: null,
    confirm: p.contract.type === 'ML' ? `Release ${p.first} ${p.last}? He goes on release waivers and you owe his remaining salary if he clears.` : `Release ${p.first} ${p.last}?`,
    run: () => releasePlayer(league, p),
  });
  return out;
}

export function mlbCounts(league: League): { active: number } {
  return { active: activeAt(league, league.userOrgId, 'MLB').length };
}
