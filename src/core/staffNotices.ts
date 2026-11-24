// Reminders about your own staff: contracts that run out after this season,
// and an empty assistant GM job (nothing you've delegated to him gets done).
import type { InboxMsg, League, Staff } from './types.ts';
import { STAFF_NAMES, STAFF_ROLES } from './types.ts';
import { extendStaff, keyRating, staffOf } from './staff.ts';
import { addInbox } from './morale.ts';
import { fmtMoney } from './contracts.ts';

const expiring = (league: League): Staff[] => {
  const org = league.orgs[league.userOrgId];
  return STAFF_ROLES.map((r) => staffOf(league, org, r)).filter((s): s is Staff => !!s && s.exp <= league.season);
};

// Two weeks before the end of the regular season.
export function staffExpiryNotice(league: League): void {
  const exp = expiring(league);
  if (!exp.length) return;
  const agm = exp.some((s) => s.role === 'AGM');
  addInbox(league, {
    from: 'Front office', kind: 'staff', pids: [], stop: true, link: { page: 'staff' },
    subject: `${exp.length} staff contract${exp.length === 1 ? '' : 's'} run out after this season`,
    text: `${exp.map((s) => `${STAFF_NAMES[s.role]} ${s.first} ${s.last} (rated ${Math.round(keyRating(s))}, ${fmtMoney(s.salary)})`).join('; ')}. They leave when the new season starts unless you extend them.${agm ? " That includes your assistant GM: without one, nothing you've handed him (roster moves, injuries, the draft...) gets done." : ''}`,
    actions: [
      { key: 'extend', label: 'Extend them all 2 years' },
      { key: 'page', label: "I'll decide on the Staff page" },
      { key: 'leave', label: 'Let them go' },
    ],
  });
}

export function answerStaffExpiry(league: League, msg: InboxMsg, key: string): string {
  msg.read = true;
  msg.resolved = msg.actions?.find((a) => a.key === key)?.label ?? key;
  const exp = expiring(league);
  if (key === 'extend') {
    for (const s of exp) extendStaff(league, s, 2);
    return exp.length ? `Extended ${exp.map((s) => `${s.first} ${s.last}`).join(', ')} through ${league.season + 2} (about 5% raises).` : 'Nobody left to extend.';
  }
  if (key === 'leave') return 'They will leave when the new season starts. You can hire replacements on the Staff page.';
  return 'You can extend or replace them on the Staff page any time before the new season.';
}

// Once each winter and spring: no assistant GM while you have duties delegated to him.
export function agmVacancyNotice(league: League): boolean {
  const org = league.orgs[league.userOrgId];
  const key = `agm-vacant-${league.phase}`;
  if (org.staff.AGM !== undefined || league.events.includes(key) || !Object.values(org.agm).some(Boolean)) return false;
  league.events.push(key);
  addInbox(league, {
    from: 'Front office', kind: 'info', pids: [], stop: true, link: { page: 'staff' },
    subject: 'You have no assistant GM',
    text: "Your assistant GM job is empty, so the duties you handed him (roster moves, injuries, the draft and so on) aren't being done. Hire one on the Staff page, or take those duties back yourself.",
  }).stopped = true; // the caller returns the pause
  return true;
}
