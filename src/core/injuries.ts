// Serious injuries: surgery or rehab.
//
// Surgery: a long recovery, usually a full one (sometimes a small permanent
// loss). Rehab: back sooner, but with a real chance of re-injuring it in the
// months after he returns, which then means surgery anyway. Your medical
// staff estimates the risk and makes a recommendation (a bigger medical budget
// reads it better and lowers the risk); a second opinion sharpens the read.
import type { League, Player } from './types.ts';
import { isPitcher } from './ratings.ts';
import { clamp, rand, seededNormal } from './random.ts';
import { deptEffect } from './depts.ts';
import { addNews, pname } from './util.ts';
import { addInbox } from './morale.ts';
import { temp } from './storylines.ts';
import { topProspects } from './sim/lineup.ts';

interface Serious { surgery: number; risk: number; label: string }
const SERIOUS: Record<string, Serious> = {
  'UCL sprain': { surgery: 400, risk: 0.45, label: 'Tommy John surgery (about 13 months)' },
  'torn labrum': { surgery: 270, risk: 0.4, label: 'labrum repair (about 9 months)' },
  'ACL tear': { surgery: 270, risk: 0.5, label: 'ACL reconstruction (about 9 months)' },
  'flexor tendon strain': { surgery: 130, risk: 0.28, label: 'flexor tendon repair (about 4 months)' },
  'shoulder impingement': { surgery: 150, risk: 0.3, label: 'shoulder debridement (about 5 months)' },
  'torn hamstring': { surgery: 120, risk: 0.25, label: 'hamstring repair (about 4 months)' },
  'knee sprain': { surgery: 120, risk: 0.25, label: 'knee surgery (about 4 months)' },
};

const absDay = (l: League) => l.season * 400 + l.day;

function trueRisk(league: League, p: Player, s: Serious): number {
  const org = p.orgId !== null ? league.orgs[p.orgId] : null;
  const med = org ? deptEffect(org, 'medical') : 0;
  const age = league.season - p.born;
  return clamp(s.risk * (1 + (age - 28) * 0.03) * (1 - 0.15 * med) * p.injuryProne, 0.08, 0.8);
}

// Medical staff's read of the rehab risk (noisier with a smaller budget).
function read(league: League, p: Player, s: Serious, salt: number, sd: number): number {
  return clamp(trueRisk(league, p, s) + sd * seededNormal(p.scoutSeed, absDay(league), salt), 0.03, 0.9);
}

export function onInjury(league: League, p: Player): void {
  const inj = p.injury;
  if (!inj || inj.decision || inj.totalDays < 60) return;
  const s = SERIOUS[inj.name];
  if (!s || p.orgId === null) return;
  const org = league.orgs[p.orgId];
  // Rehab is the faster road back (that's the trade-off).
  if (inj.daysLeft > s.surgery * 0.65) { inj.daysLeft = Math.round(s.surgery * (0.5 + rand() * 0.15)); inj.totalDays = inj.daysLeft; }
  const med = deptEffect(org, 'medical');
  const est = read(league, p, s, 1, 0.12 * (1 - 0.4 * med));
  const age = league.season - p.born;
  const recommend: 'surgery' | 'rehab' = est > 0.35 || (inj.name === 'UCL sprain' && age < 32 && est > 0.25) ? 'surgery' : 'rehab';
  inj.decision = { estRisk: est, recommend, surgeryDays: s.surgery, label: s.label, decided: false };
  // A GM decision for players who matter (MLB, 40-man, top-30 prospects); the
  // medical staff makes the call for the rest of the system, and AI clubs follow their doctors.
  if (p.orgId !== league.userOrgId) {
    decide(league, p, recommend);
    return;
  }
  if (p.level !== 'MLB' && !p.on40 && !topProspects(league, p.orgId).has(p.id)) {
    const injName = inj.name;
    decide(league, p, recommend);
    addInbox(league, {
      from: 'Medical staff', subject: `${pname(p)}: ${recommend === 'surgery' ? s.label : 'rehab'}`, kind: 'info', pids: [p.id],
      text: `${pname(p)} (${p.level}): ${injName}. We went with ${recommend === 'surgery' ? s.label : 'rehab'} (re-injury risk with rehab about ${Math.round(est * 100)}%). He's out about ${p.injury?.daysLeft ?? inj.daysLeft} days.`,
    });
    return;
  }
  addInbox(league, {
    from: 'Medical staff', subject: `${pname(p)}: surgery or rehab?`, kind: 'injury', pids: [p.id], stop: true,
    text: `${pname(p)} has a ${inj.name}. Rehab gets him back in about ${inj.daysLeft} days, but we put the chance he re-injures it in the months after at about ${Math.round(est * 100)}% (and then it's surgery anyway). ${s.label[0].toUpperCase()}${s.label.slice(1)} should fix it. We recommend ${recommend}.`,
    actions: [{ key: 'surgery', label: 'Surgery' }, { key: 'rehab', label: 'Rehab' }, { key: 'second', label: 'Get a second opinion' }],
  });
}

function decide(league: League, p: Player, choice: 'surgery' | 'rehab'): string {
  const inj = p.injury;
  if (!inj?.decision) return 'Nothing to decide.';
  inj.decision.decided = true;
  if (choice === 'surgery') {
    inj.name = inj.decision.label.split(' (')[0];
    inj.daysLeft = Math.round(inj.decision.surgeryDays * (0.9 + rand() * 0.2));
    inj.totalDays = inj.daysLeft;
    // Usually a full recovery; sometimes a little is lost for good.
    const r = rand();
    const loss = r < 0.7 ? 0 : r < 0.92 ? 2 : 5;
    if (loss) {
      if (isPitcher(p)) { p.ratings.pit.stuff -= loss; p.pot.stuff -= loss; }
      else for (const s of [p.ratings.vL, p.ratings.vR]) { s.power -= loss * 0.6; s.babip -= loss * 0.4; }
    }
    if (p.orgId !== null) addNews(league, p.orgId === league.userOrgId ? p.orgId : null, `${pname(p)} will have ${inj.decision.label}.`, [p.id]);
    return `${pname(p)} will have surgery: out about ${inj.daysLeft} days.`;
  }
  const s = SERIOUS[inj.name];
  p.reinjury = { risk: s ? trueRisk(league, p, s) : 0.25, name: inj.name, surgeryDays: inj.decision.surgeryDays, until: 0 };
  return `${pname(p)} will rehab: out about ${inj.daysLeft} days. We'll watch him closely when he's back.`;
}

export function answerInjury(league: League, pid: number, key: string): string {
  const p = league.players[pid];
  if (!p?.injury?.decision) return 'Nothing to decide.';
  if (key === 'second') {
    const s = SERIOUS[p.injury.name];
    const msg = (league.inbox ?? []).find((m) => m.kind === 'injury' && m.pids[0] === pid && m.resolved);
    if (msg) { msg.resolved = undefined; msg.actions = msg.actions?.filter((a) => a.key !== 'second'); }
    if (!s) return 'No second opinion available.';
    const est2 = read(league, p, s, 2, 0.05);
    if (msg) msg.text += ` Second opinion: about ${Math.round(est2 * 100)}% re-injury risk with rehab.`;
    return `Second opinion: about ${Math.round(est2 * 100)}% chance of re-injury if he rehabs.`;
  }
  return decide(league, p, key === 'surgery' ? 'surgery' : 'rehab');
}

// Daily: players who chose rehab can re-injure it in the 100 days after they return.
export function reinjuryCheck(league: League): void {
  if (league.phase !== 'regular') return;
  for (const p of Object.values(league.players)) {
    const r = p.reinjury;
    if (!r || p.injury || p.orgId === null) continue;
    if (!r.until) r.until = absDay(league) + 100;
    if (absDay(league) > r.until) { p.reinjury = undefined; continue; }
    if (rand() < r.risk / 100) {
      p.injury = { name: `re-injured ${r.name}`, daysLeft: r.surgeryDays, totalDays: r.surgeryDays };
      p.reinjury = undefined;
      addNews(league, p.orgId === league.userOrgId ? p.orgId : null, `${pname(p)} re-injured his ${r.name.replace('sprain', 'elbow').replace('strain', '')} and needs surgery: out about ${r.surgeryDays} days.`, [p.id]);
    }
  }
  void temp;
}
