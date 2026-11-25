// Upgrades leagues saved by older versions.
import type { League, Staff } from './types.ts';
import { STAFF_ROLES } from './types.ts';
import { ORG_DEFS } from './teams.ts';
import { defaultAgm, makeStaff, refreshStaffPool } from './staff.ts';
import { onSeasonEnd } from './offseason.ts';
import { generateCbPicks, generateDraftClass, normalizeAdjust } from './draft.ts';
import { makeOwner, setBudgets, setOwnerGoals, updateStrategies } from './owners.ts';
import { updateStances } from './market.ts';
import { aiDepts, opBudgetFor } from './depts.ts';
import { setOvrBaseline } from './offseason.ts';
import { shiftPendingDays } from './dayShift.ts';
import { dayToDate } from './settings.ts';

export const CURRENT_VERSION = 7;

export function migrate(league: League): League {
  const l = league as League & { farmDirectors?: Staff[]; settings: League['settings'] & { autoMlbMoves?: boolean } };
  let needsSeasonEnd = false;
  if ((l.version ?? 1) < 4) {
    for (const org of l.orgs) {
      org.stance ??= 'Listening';
      org.block ??= [];
      org.interest ??= { pids: [], pos: [] };
    }
    l.moves ??= [];
  }
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
    // Old leagues stopped at the end of the World Series with no offseason; start it after the v3 upgrade.
    needsSeasonEnd = l.phase === 'offseason';
    l.version = 2;
  }
  if (l.version < 3) {
    for (const org of l.orgs) {
      org.owner = makeOwner(l.season);
      org.strategy = 'Retool';
      org.budget = 0;
      org.cash = [];
      org.agm.trades = false;
    }
    l.cbPicks = [];
    l.tradeOffers = [];
    l.ifaPenalty = {};
    l.draftAdjust = normalizeAdjust(l.draftAdjust);
    Object.assign(l.settings, { tradeDeadlineDay: 127, postseasonEligibilityDay: 158, tradeDifficulty: 'Normal', aiTradeFactor: 1 });
    for (const p of Object.values(l.players)) if (p.orgId !== null) p.teamSince ??= l.season - Math.min(p.proSeasons, 3);
    updateStrategies(l);
    setBudgets(l);
    const draftSeason = l.phase === 'offseason' ? l.season + 1 : l.season;
    if (!(l.phase === 'regular' && l.day > l.settings.draftDay)) generateCbPicks(l, draftSeason);
    l.version = 3;
  }
  if (l.version < 4) {
    // Scouting departments, trade market, owner goals, the move log.
    let sid = Math.max(l.nextId.staff, ...l.staff.map((s) => s.id + 1));
    for (const org of l.orgs) {
      for (const role of STAFF_ROLES) {
        if (org.staff[role] !== undefined) continue;
        const st = makeStaff(sid++, role, org.id, l.season);
        l.staff.push(st);
        org.staff[role] = st.id;
      }
    }
    l.nextId.staff = sid;
    refreshStaffPool(l);
    l.settings.allowFiring ??= true;
    updateStances(l);
    if (l.phase !== 'offseason') setOwnerGoals(l);
    l.version = 4;
  }
  if (l.version < 5) {
    // Veterans with 5+ years of service start out of options.
    for (const p of Object.values(l.players)) {
      if (p.mlServiceDays >= 5 * l.settings.serviceDaysPerYear && p.optionsUsed < l.settings.optionYears) p.optionsUsed = l.settings.optionYears;
    }
    l.version = 5;
  }
  if (l.version < 6) {
    // Department budgets.
    for (const org of l.orgs) {
      org.facilities ??= 0;
      org.opBudget = opBudgetFor(org);
      org.depts = aiDepts(org);
    }
    if (l.phase !== 'offseason') setOvrBaseline(l);
    l.version = 6;
  }
  if (l.version < 7) {
    // Pending free agent decisions, waivers, trade answers etc. weren't moved
    // when the new season's day count started, so they sat a year in the future.
    if (l.phase === 'preseason' || (l.phase === 'regular' && l.day < 120)) {
      const delta = Math.round((dayToDate(l.season - 1, 0).getTime() - dayToDate(l.season, 0).getTime()) / 86400000);
      const cut = Math.max(150, l.day + 100);
      shiftPendingDays(l, delta, (d) => d > cut);
    }
    l.version = 7;
  }
  if (needsSeasonEnd) onSeasonEnd(l);
  return l;
}
