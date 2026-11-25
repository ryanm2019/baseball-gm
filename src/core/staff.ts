// Front office and coaching staff: generation, hiring, and the effect each
// role has on the game.
import type { AgmDuty, League, ManagerStyle, Org, Philosophy, Player, Staff, StaffRole } from './types.ts';
import { AGM_DUTIES, STAFF_NAMES, STAFF_ROLES } from './types.ts';
import { clamp, choice, normal, rand, randInt } from './random.ts';
import { randomStaffName } from './names.ts';
import { roundSalary } from './contracts.ts';
import { addNews } from './util.ts';
import { deptEffect } from './depts.ts';

const r = () => clamp(Math.round(normal(50, 10)), 25, 80);
const isScout = (role: StaffRole) => role === 'SD' || role === 'PRO' || role === 'AMA' || role === 'INT';

const BASE_SALARY: Record<StaffRole, number> = {
  AGM: 450_000, MGR: 1_500_000, PC: 450_000, HC: 400_000, FD: 300_000,
  SD: 350_000, PRO: 150_000, AMA: 150_000, INT: 150_000,
};

export function makeStaff(id: number, role: StaffRole, orgId: number | null, season: number): Staff {
  const { first, last } = randomStaffName();
  const s: Staff = {
    id,
    role,
    first,
    last,
    age: randInt(role === 'MGR' ? 38 : isScout(role) ? 26 : 32, 70),
    development: r(),
    // Scouts vary more: some clubs have elite departments, some are threadbare.
    evaluation: isScout(role) ? clamp(Math.round(normal(50, 13)), 20, 80) : r(),
    negotiation: r(),
    tactics: r(),
    health: r(),
    philosophy: choice<Philosophy>(['Conservative', 'Balanced', 'Balanced', 'Aggressive']),
    style: choice<ManagerStyle>(['Old school', 'Balanced', 'Balanced', 'Analytical']),
    salary: 0,
    exp: season + randInt(0, 3),
    orgId,
  };
  const q = keyRating(s);
  s.salary = roundSalary(BASE_SALARY[role] * (0.6 + ((q - 30) / 45) * 1.1) * (0.9 + rand() * 0.2));
  return s;
}

// The rating that matters most for each role (used for salary and sorting).
export function keyRating(s: Staff): number {
  switch (s.role) {
    case 'AGM':
      return (s.evaluation + s.negotiation) / 2;
    case 'MGR':
      return s.tactics;
    case 'PC':
      return (s.development * 2 + s.health) / 3;
    case 'HC':
      return s.development;
    case 'FD':
      return (s.development + s.evaluation) / 2;
    default:
      return s.evaluation; // scouts
  }
}

export function defaultAgm(): Record<AgmDuty, boolean> {
  const out = {} as Record<AgmDuty, boolean>;
  for (const d of AGM_DUTIES) out[d.key] = d.def;
  return out;
}

export function staffOf(league: League, org: Org, role: StaffRole): Staff | undefined {
  const id = org.staff[role];
  return id === undefined ? undefined : league.staff.find((s) => s.id === id);
}

export function hireStaff(league: League, org: Org, s: Staff): string | null {
  if (s.orgId !== null) return 'Already employed';
  const cur = staffOf(league, org, s.role);
  if (cur) cur.orgId = null;
  s.orgId = org.id;
  s.exp = league.season + (league.phase === 'offseason' ? 2 : 1);
  org.staff[s.role] = s.id;
  addNews(league, org.id, `Hired ${s.first} ${s.last} as ${STAFF_NAMES[s.role].toLowerCase()}.`);
  return null;
}

export function fireStaff(league: League, org: Org, role: StaffRole): void {
  const cur = staffOf(league, org, role);
  if (!cur) return;
  cur.orgId = null;
  delete org.staff[role];
  addNews(league, org.id, `Fired ${STAFF_NAMES[role].toLowerCase()} ${cur.first} ${cur.last}.`);
}

export function extendStaff(league: League, s: Staff, years: number): void {
  s.exp = Math.max(s.exp, league.season) + years;
  s.salary = roundSalary(s.salary * 1.05);
}

// Keeps a healthy pool of unemployed candidates for every role.
export function refreshStaffPool(league: League): void {
  for (const role of STAFF_ROLES) {
    const free = league.staff.filter((s) => s.role === role && s.orgId === null);
    for (let i = free.length; i < 10; i++) league.staff.push(makeStaff(league.nextId.staff++, role, null, league.season));
  }
}

// AI clubs re-sign or replace staff whose contracts ran out; the user's
// staff leave unless extended.
export function staffContractsExpire(league: League): void {
  for (const org of league.orgs) {
    for (const role of STAFF_ROLES) {
      const s = staffOf(league, org, role);
      if (!s || s.exp >= league.season) continue;
      if (org.id === league.userOrgId) {
        s.orgId = null;
        delete org.staff[role];
        addNews(league, org.id, `${STAFF_NAMES[role]} ${s.first} ${s.last}'s contract expired and he left the organization.`);
        continue;
      }
      if (keyRating(s) >= 48 || rand() < 0.5) extendStaff(league, s, randInt(1, 3));
      else {
        s.orgId = null;
        delete org.staff[role];
      }
    }
    for (const role of STAFF_ROLES) {
      if (org.id === league.userOrgId || org.staff[role] !== undefined) continue;
      const pool = league.staff.filter((s) => s.role === role && s.orgId === null).sort((a, b) => keyRating(b) - keyRating(a));
      const pick = pool[Math.min(pool.length - 1, randInt(0, 3))];
      if (pick) {
        pick.orgId = org.id;
        pick.exp = league.season + randInt(1, 3);
        org.staff[role] = pick.id;
      }
    }
  }
  for (const s of league.staff) if (s.orgId === null) s.age++;
  league.staff = league.staff.filter((s) => s.orgId !== null || s.age < 72);
  refreshStaffPool(league);
}

// ---------- effects ----------

const scale = (v: number, lo: number, hi: number) => lo + ((clamp(v, 20, 80) - 20) / 60) * (hi - lo);

// Development speed. MLB players are coached by the pitching/hitting coach;
// minor leaguers by the farm director.
export function devMultiplier(league: League, p: Player): number {
  if (p.orgId === null) return 0.9;
  const org = league.orgs[p.orgId];
  const budget = 1 + 0.08 * deptEffect(org, 'development');
  if (p.level === 'MLB') {
    const coach = staffOf(league, org, p.pos === 'SP' || p.pos === 'RP' ? 'PC' : 'HC');
    return (coach ? scale(coach.development, 0.85, 1.15) : 0.85) * budget;
  }
  const fd = staffOf(league, org, 'FD');
  return (fd ? scale(fd.development, 0.85, 1.15) : 0.85) * budget;
}

// Pitcher injury risk for MLB pitchers depends on the pitching coach.
export function pitcherInjuryMult(league: League, orgId: number, level: string): number {
  if (level !== 'MLB') return 1;
  const pc = staffOf(league, league.orgs[orgId], 'PC');
  return pc ? scale(pc.health, 1.15, 0.85) : 1.15;
}

export interface ManagerMods {
  hook: number; // >1 lets starters go deeper
  ttoPull: number; // chance to pull a starter the third time through
  steal: number;
  bullpenSkill: number; // 0..1, how often he picks the right reliever
}

export function managerMods(league: League, orgId: number, level: string): ManagerMods {
  if (level !== 'MLB') return { hook: 1, ttoPull: 0.3, steal: 1, bullpenSkill: 0.7 };
  const m = staffOf(league, league.orgs[orgId], 'MGR');
  if (!m) return { hook: 1, ttoPull: 0.3, steal: 1, bullpenSkill: 0.5 };
  const style = m.style;
  return {
    hook: style === 'Old school' ? 1.06 : style === 'Analytical' ? 0.95 : 1,
    ttoPull: style === 'Analytical' ? 0.5 : style === 'Old school' ? 0.15 : 0.3,
    steal: style === 'Old school' ? 1.15 : style === 'Analytical' ? 0.9 : 1,
    bullpenSkill: scale(m.tactics, 0.35, 0.95),
  };
}

// How noisy the assistant GM's player evaluations are (0 = perfect).
export function agmEvalSd(league: League, org: Org): number {
  const a = staffOf(league, org, 'AGM');
  return a ? Math.max(0, ((80 - a.evaluation) / 60) * 5) : 5;
}

export function delegated(league: League, org: Org, duty: AgmDuty): boolean {
  if (org.id !== league.userOrgId) return true;
  return !!(org.agm[duty] ?? AGM_DUTIES.find((d) => d.key === duty)?.def) && org.staff.AGM !== undefined;
}
