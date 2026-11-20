// Upgrades leagues saved by older versions.
import type { League, Staff } from './types.ts';
import { STAFF_ROLES } from './types.ts';
import { ORG_DEFS } from './teams.ts';
import { defaultAgm, makeStaff, refreshStaffPool } from './staff.ts';
import { generateDraftClass } from './draft.ts';
import { onSeasonEnd } from './offseason.ts';

export const CURRENT_VERSION = 2;

export function migrate(league: League): League {
  const l = league as League & { farmDirectors?: Staff[]; settings: League['settings'] & { autoMlbMoves?: boolean } };
  if ((l.version ?? 1) < 2) {
    const auto = l.settings.autoMlbMoves ?? true;
    delete l.settings.autoMlbMoves;
    l.settings.draftDay = 108;
    l.settings.draftSigningDays = 22;
    l.settings.draftRounds = 20;
    const old = l.farmDirectors ?? [];
    delete l.farmDirectors;
    l.staff = old.map((f) => ({ ...makeStaff(f.id, 'FD', f.orgId, l.season), ...f, role: 'FD' as const }));
    let sid = Math.max(0, ...l.staff.map((s) => s.id)) + 1;
    for (const org of l.orgs) {
      const o = org as typeof org & { farmDirectorId?: number | null };
      org.market = ORG_DEFS.find((d) => d.abbrev === org.abbrev)?.market ?? 1;
      org.staff = {};
      if (o.farmDirectorId != null) org.staff.FD = o.farmDirectorId;
      delete o.farmDirectorId;
      for (const role of STAFF_ROLES) {
        if (org.staff[role] !== undefined) continue;
        const st = makeStaff(sid++, role, org.id, l.season);
        l.staff.push(st);
        org.staff[role] = st.id;
      }
      org.agm = defaultAgm();
      if (org.id === l.userOrgId) org.agm.injuries = auto;
      org.tenderPlan = {};
      org.optionPlan = {};
      org.qoPlan = {};
      org.rule5Targets = [];
    }
    l.nextId.staff = sid;
    l.events = [];
    l.draft = null;
    l.intl = { pools: {}, spent: {}, open: false };
    l.cbtHistory = [];
    l.wsEndDay = null;
    for (const p of Object.values(l.players)) p.signAge ??= Math.max(16, l.season - p.proSeasons - p.born);
    refreshStaffPool(l);
    if (l.phase === 'regular' && l.day <= l.settings.draftDay) generateDraftClass(l, l.season);
    // Old leagues stopped at the end of the World Series with no offseason; start it now.
    if (l.phase === 'offseason') onSeasonEnd(l);
    l.version = 2;
  }
  return l;
}
