// Department budgets (like Basketball GM's expense levels): scouting, player
// development, medical and facilities, paid from an operating budget the owner
// sets apart from payroll.
import type { Dept, League, Org, OwnerType } from './types.ts';
import { clamp, rand } from './random.ts';

export const DEPTS: { key: Dept; label: string; base: number; help: string }[] = [
  { key: 'scouting', label: 'Scouting', base: 12e6, help: 'Sharper ratings everywhere: other teams, the draft, international amateurs and your own players.' },
  { key: 'development', label: 'Player development', base: 18e6, help: 'Faster progress toward potential for everyone in the organization.' },
  { key: 'medical', label: 'Medical / training', base: 12e6, help: 'Fewer injuries and quicker recoveries, majors and minors.' },
  { key: 'facilities', label: 'Facilities', base: 25e6, help: 'Builds up (or decays) slowly over seasons. Better facilities make free agents like you more.' },
];

const DEPT_BASE = Object.fromEntries(DEPTS.map((d) => [d.key, d.base])) as Record<Dept, number>;
const OWNER_OPS: Record<OwnerType, number> = { Cheap: 0.8, Moderate: 1, 'Big spender': 1.25, 'Win-now': 1.1 };

// The owner's operating budget for departments.
export function opBudgetFor(org: Org): number {
  const total = DEPTS.reduce((t, d) => t + d.base, 0);
  return Math.round((total * OWNER_OPS[org.owner.type] * (0.9 + 0.2 * Math.min(1.5, org.market))) / 1e6) * 1e6;
}

// AI clubs split their operating budget by how they're built.
export function aiDepts(org: Org): Record<Dept, number> {
  const ops = org.opBudget;
  const total = DEPTS.reduce((t, d) => t + d.base, 0);
  const tilt: Record<Dept, number> = {
    scouting: org.strategy === 'Rebuild' ? 1.15 : 1,
    development: org.strategy === 'Rebuild' ? 1.15 : org.strategy === 'Contend' ? 0.95 : 1,
    medical: org.strategy === 'Contend' ? 1.15 : 1,
    facilities: org.strategy === 'Rebuild' ? 0.85 : 1,
  };
  const out = {} as Record<Dept, number>;
  for (const d of DEPTS) out[d.key] = (d.base / total) * ops * tilt[d.key] * (0.92 + rand() * 0.16);
  // Fit inside the operating budget.
  const sum = DEPTS.reduce((t, d) => t + out[d.key], 0);
  const f = Math.min(1, (ops * 0.98) / sum);
  for (const d of DEPTS) out[d.key] = Math.floor((out[d.key] * f) / 0.25e6) * 0.25e6;
  return out;
}

export const deptSpend = (org: Org): number => DEPTS.reduce((t, d) => t + (org.depts?.[d.key] ?? d.base), 0);

// -1 (half of a normal budget or less) .. 0 (normal) .. +1 (double or more).
export function deptEffect(org: Org | undefined, d: Dept): number {
  if (!org || !org.depts) return 0;
  if (d === 'facilities') return clamp(org.facilities ?? 0, -1, 1);
  return clamp(Math.log2(Math.max(0.01, org.depts[d]) / DEPT_BASE[d]), -1, 1);
}

// Facilities move slowly toward what you spend: about a third of the way each season.
export function updateFacilities(league: League): void {
  for (const org of league.orgs) {
    const e = clamp(Math.log2(Math.max(0.01, org.depts.facilities) / DEPT_BASE.facilities), -1, 1);
    org.facilities = (org.facilities ?? 0) * 0.67 + e * 0.33;
  }
}

// Winter: owners set operating budgets; AI clubs re-split theirs.
export function setDeptBudgets(league: League): void {
  for (const org of league.orgs) {
    org.opBudget = opBudgetFor(org);
    if (org.id !== league.userOrgId) org.depts = aiDepts(org);
  }
}

export function effectText(org: Org, d: Dept): string {
  const e = deptEffect(org, d);
  const pct = (x: number) => `${x >= 0 ? '+' : ''}${Math.round(x * 100)}%`;
  switch (d) {
    case 'scouting': return `${pct(-0.2 * e)} scouting error`;
    case 'development': return `${pct(0.08 * e)} development speed`;
    case 'medical': return `${pct(-0.18 * e)} injury rate, ${pct(0.25 * e)} recovery speed`;
    case 'facilities': return `Facilities ${e >= 0.5 ? 'excellent' : e >= 0.15 ? 'good' : e > -0.15 ? 'average' : e > -0.5 ? 'worn' : 'poor'}: ${pct(0.06 * e)} free agent appeal`;
  }
}
