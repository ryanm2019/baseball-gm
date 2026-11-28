// Your scouting department, run like a real one:
//  - Each month the scouting director sends every scout out on a set number of
//    looks, chosen by what the club needs: when buying, pro scouts work other
//    clubs' big league rosters at your weak spots; when selling, they work the
//    farm systems of the contenders you'd trade with. The amateur department
//    covers the draft class from the spring until the draft (about 200 reports),
//    the international department the new class until signing day (about 100).
//    The internal coverage scout writes up your own system.
//  - Every look files a written report: tool grades, a role projection, risk,
//    and a short write-up. A report sharpens your read on that player for months.
//  - You can ask for a report on anyone, or rush reports on the players in a
//    trade you're weighing (back in a day or two).
import type { League, Org, Player, ScoutMode, ScoutReport, ScoutingState, StaffRole } from './types.ts';
import { contact, isPitcher, posRating, scout, scoutedOvr, scoutedPot } from './ratings.ts';
import { orgPlayers, pname } from './util.ts';
import { teamNeeds } from './market.ts';
import { addInbox } from './morale.ts';
import { expectedWins } from './owners.ts';
import { dayToDate, dayShort } from './settings.ts';
import { posLabel } from './rules.ts';
import { shuffle } from './random.ts';
import { offseasonCalendar } from './offseason.ts';

export function scouting(league: League): ScoutingState {
  league.scouting ??= { reports: {}, mode: 'auto', month: '', plan: [], rush: [], requests: [], fresh: [], lastDigest: league.day };
  return league.scouting;
}

const ROLE_NAME: Record<string, string> = { SD: 'Scouting director', PRO: 'Pro scout', AMA: 'Amateur scout', INT: 'International scout', ICS: 'Internal coverage scout' };
export const scoutName = (league: League, role: StaffRole): string => {
  const id = league.orgs[league.userOrgId].staff[role];
  const s = id !== undefined ? league.staff.find((x) => x.id === id) : undefined;
  return s ? `${s.first} ${s.last}` : ROLE_NAME[role];
};

// Looks per month: better scouts cover more ground; an empty chair covers little.
// Draft season: the class is out (spring) and the draft hasn't happened.
export const draftSeason = (league: League): boolean =>
  (league.phase === 'preseason' || (league.phase === 'regular' && league.day <= league.settings.draftDay)) && Object.values(league.players).some((p) => p.prospect && p.orgId === null && !p.retired);
// The international class is out and unsigned (posted pros don't count).
export const intlSeason = (league: League): boolean => Object.values(league.players).some((p) => p.ifa && !p.ifa.posted && p.orgId === null && !p.retired);

export function visitsPerMonth(league: League, role: StaffRole): number {
  const org = league.orgs[league.userOrgId];
  const id = org.staff[role];
  const s = id !== undefined ? league.staff.find((x) => x.id === id) : undefined;
  // In their seasons the amateur departments (area scouts and crosscheckers
  // behind the lead scout) cover a class broadly.
  const base = role === 'SD' ? 4 : role === 'AMA' ? (draftSeason(league) ? 40 : 14) : role === 'INT' ? (intlSeason(league) ? 60 : 10) : 14;
  if (!s) return Math.round(base * 0.35);
  return Math.round(base * (0.8 + 0.4 * ((s.evaluation - 20) / 60)));
}

// What the director is planning around: buying, selling, or a bit of both.
export function scoutPlan(league: League): { mode: Exclude<ScoutMode, 'auto'>; why: string } {
  const st = scouting(league);
  if (st.mode !== 'auto') return { mode: st.mode, why: 'your call' };
  const org = league.orgs[league.userOrgId];
  const s = league.standings.MLB[org.id];
  const played = s ? s.w + s.l : 0;
  const pace = played >= 30 ? (s.w / played) * 162 : expectedWins(league, org.id);
  if (pace >= 86 || org.strategy === 'Contend') return { mode: 'buying', why: played >= 30 ? `on a ${Math.round(pace)}-win pace` : 'a contender on paper' };
  if (pace <= 74 || org.strategy === 'Rebuild') return { mode: 'selling', why: played >= 30 ? `on a ${Math.round(pace)}-win pace` : 'rebuilding' };
  return { mode: 'balanced', why: 'in the middle of the pack' };
}

const recent = (league: League, pid: number, days: number): boolean => {
  const r = scouting(league).reports[pid];
  return !!r && (league.season - r.season) * 365 + league.day - r.day < days;
};

// The director's targets for one scout this month.
export function targetsFor(league: League, role: StaffRole, n: number): { pid: number; why: string }[] {
  const user = league.orgs[league.userOrgId];
  const plan = scoutPlan(league).mode;
  const others = league.orgs.filter((o) => o.id !== user.id);
  const out: { pid: number; why: string }[] = [];
  const add = (ps: Player[], why: (p: Player) => string, k: number) => {
    for (const p of ps) {
      if (out.length >= n || k <= 0) break;
      if (out.some((x) => x.pid === p.id) || recent(league, p.id, 120)) continue;
      out.push({ pid: p.id, why: why(p) });
      k--;
    }
  };
  // Big league help at your weak spots (buying).
  const mlbTargets = (k: number) => {
    const needs = teamNeeds(league, user.id);
    // No weak spots: scout the best players sellers might move (their blocks first).
    if (!needs.length) {
      const sellers = others.filter((o) => o.stance === 'Selling' || o.stance === 'Listening');
      const ps = sellers.flatMap((o) => orgPlayers(league, o.id).filter((p) => p.level === 'MLB' && league.season - p.born >= 24));
      ps.sort((a, b) => scoutedOvr(league, b) + (league.orgs[b.orgId!].block.includes(b.id) ? 6 : 0) - (scoutedOvr(league, a) + (league.orgs[a.orgId!].block.includes(a.id) ? 6 : 0)));
      add(ps.slice(0, 80), (p) => `possible trade target (${league.orgs[p.orgId!].abbrev}${league.orgs[p.orgId!].block.includes(p.id) ? ', on their block' : ''})`, k);
      return;
    }
    // Real upgrades at each weak spot, taking turns between the spots.
    const lists = needs.map((pos) => {
      const mine = Math.max(0, ...orgPlayers(league, user.id).filter((q) => q.level === 'MLB' && q.pos === pos).map((q) => scoutedOvr(league, q)));
      const ps = others.flatMap((o) => orgPlayers(league, o.id).filter((p) => (p.level === 'MLB' || p.level === 'AAA') && p.pos === pos && scoutedOvr(league, p) >= mine));
      return ps.sort((a, b) => scoutedOvr(league, b) + (league.orgs[b.orgId!].stance === 'Selling' ? 4 : 0) - (scoutedOvr(league, a) + (league.orgs[a.orgId!].stance === 'Selling' ? 4 : 0))).slice(0, 40);
    });
    const mixed: Player[] = [];
    for (let i = 0; i < 40; i++) for (const l of lists) if (l[i]) mixed.push(l[i]);
    add(mixed, (p) => `possible ${p.pos} upgrade (${league.orgs[p.orgId!].abbrev}${league.orgs[p.orgId!].stance === 'Selling' ? ', a seller' : ''})`, k);
  };
  // Prospects in contenders' farm systems (selling).
  const farmTargets = (k: number) => {
    const buyers = others.filter((o) => o.stance === 'Buying' || o.strategy === 'Contend');
    const ps = (buyers.length ? buyers : others).flatMap((o) => orgPlayers(league, o.id).filter((p) => p.level && p.level !== 'MLB' && league.season - p.born <= 25));
    ps.sort((a, b) => scoutedPot(league, b) - scoutedPot(league, a));
    add(shuffle(ps.slice(0, 120)).sort((a, b) => scoutedPot(league, b) - scoutedPot(league, a)), (p) => `prospect in a contender's system (${league.orgs[p.orgId!].abbrev}, ${p.level})`, k);
  };
  if (role === 'PRO' || role === 'SD') {
    if (plan === 'buying') { mlbTargets(Math.ceil(n * 0.8)); farmTargets(n); }
    else if (plan === 'selling') { farmTargets(Math.ceil(n * 0.8)); mlbTargets(n); }
    else { mlbTargets(Math.ceil(n / 2)); farmTargets(n); }
  } else if (role === 'AMA') {
    const cls = Object.values(league.players).filter((p) => p.prospect && p.orgId === null && !p.retired);
    cls.sort((a, b) => scoutedPot(league, b) - scoutedPot(league, a));
    add(cls.slice(0, 150), (p) => `${league.season} draft class (${p.prospect!.college ? 'college' : 'high school'})`, n);
    if (out.length < n) farmTargets(n); // between classes: low-minors coverage
  } else if (role === 'ICS') {
    // Your own system: top prospects first, then the rest of the 40-man; each
    // gets a fresh write-up every couple of months.
    const mine = orgPlayers(league, user.id).filter((p) => !p.retired && p.level);
    const prospects = mine.filter((p) => p.level !== 'MLB' && league.season - p.born <= 25).sort((a, b) => scoutedPot(league, b) - scoutedPot(league, a)).slice(0, 30);
    const forty = mine.filter((p) => p.on40 && p.level !== 'MLB').sort((a, b) => scoutedOvr(league, b) - scoutedOvr(league, a));
    const mlb = mine.filter((p) => p.level === 'MLB' && league.season - p.born <= 27).sort((a, b) => scoutedPot(league, b) - scoutedPot(league, a));
    const fresh = (ps: Player[]) => ps.filter((p) => !recent(league, p.id, 60));
    add(fresh(prospects), (p) => `our system: ${p.level} prospect`, n);
    add(fresh(forty), (p) => `our 40-man (${p.level})`, n);
    add(fresh(mlb), () => 'our young big leaguer', n);
  } else if (role === 'INT') {
    const cls = Object.values(league.players).filter((p) => p.ifa && p.orgId === null && !p.retired);
    cls.sort((a, b) => scoutedPot(league, b) - scoutedPot(league, a));
    add(cls.slice(0, 100), (p) => `international amateur (${p.country})`, n);
    if (out.length < n) {
      const ps = others.flatMap((o) => orgPlayers(league, o.id).filter((p) => p.level === 'DSL' || p.level === 'CPX'));
      ps.sort((a, b) => scoutedPot(league, b) - scoutedPot(league, a));
      add(ps.slice(0, 100), (p) => `complex-league prospect (${league.orgs[p.orgId!].abbrev})`, n);
    }
  }
  return out;
}

const monthKey = (league: League) => { const d = dayToDate(league.season, league.day); return `${d.getFullYear()}-${d.getMonth()}`; };

// A new month: the director sets everyone's assignments.
function planMonth(league: League): void {
  const st = scouting(league);
  st.month = monthKey(league);
  st.plan = [];
  for (const role of ['PRO', 'AMA', 'INT', 'ICS', 'SD'] as StaffRole[]) planRole(league, role, 28);
}

// One scout's looks over the next `days` days. Your requests come first: on
// your own players the internal coverage scout takes them; on anyone else, the
// pro scout and the director.
function planRole(league: League, role: StaffRole, days: number): void {
  const st = scouting(league);
  const n = Math.max(1, Math.round((visitsPerMonth(league, role) * days) / 28));
  const ownReq = (pid: number) => league.players[pid]?.orgId === league.userOrgId;
  const take = (k: number, own: boolean) => {
    const out: number[] = [];
    st.requests = st.requests.filter((pid) => { if (out.length < k && ownReq(pid) === own) { out.push(pid); return false; } return true; });
    return out;
  };
  const asks = (role === 'ICS' ? take(4, true) : role === 'PRO' || role === 'SD' ? take(role === 'SD' ? 2 : 4, false) : []).map((pid) => ({ pid, why: 'you asked for a look' }));
  const picks = [...asks, ...targetsFor(league, role, n - asks.length)];
  // Amateur looks all land before the class signs (signing day, the draft).
  const deadline = role === 'INT' && intlSeason(league) ? offseasonCalendar(league).find((e) => e.key === 'ifa-open')?.day
    : role === 'AMA' && draftSeason(league) ? league.settings.draftDay : undefined;
  const span = deadline !== undefined && deadline > league.day ? Math.min(days, deadline - league.day) : days;
  picks.forEach((t, i) => st.plan.push({ pid: t.pid, by: role, due: league.day + Math.floor(((i + 0.5) * span) / Math.max(1, picks.length)), why: t.why }));
}

// A new class came out mid-month: that department re-plans the rest of it.
export function replanScout(league: League, role: StaffRole): void {
  const st = scouting(league);
  if (!st.month) return;
  st.plan = st.plan.filter((x) => x.by !== role);
  const d = dayToDate(league.season, league.day);
  const left = Math.max(3, Math.round((new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() - d.getTime()) / 864e5)); // days left this month
  planRole(league, role, left);
}

const PITCH: Record<string, string> = { FB: 'Fastball', SI: 'Sinker', CT: 'Cutter', SL: 'Slider', SW: 'Sweeper', CB: 'Curveball', CH: 'Changeup', SP: 'Splitter', KN: 'Knuckleball' };
const an = (w: string) => (/^[aeiou]/i.test(w) ? 'an' : 'a');
const lowerRole = (r: string) => (/^(No\.|All-Star)/.test(r) ? r : r[0].toLowerCase() + r.slice(1));
const adj = (v: number) => (v >= 70 ? 'plus-plus' : v >= 60 ? 'plus' : v >= 55 ? 'above-average' : v >= 45 ? 'average' : v >= 40 ? 'fringy' : 'well below-average');

function roleFor(p: Player, pot: number): string {
  if (isPitcher(p)) {
    const sp = p.pos === 'SP';
    return pot >= 70 ? (sp ? 'Ace' : 'Elite closer') : pot >= 65 ? (sp ? 'No. 2 starter' : 'Closer') : pot >= 60 ? (sp ? 'No. 3 starter' : 'Setup man') : pot >= 55 ? (sp ? 'No. 4 starter' : 'Late-inning reliever') : pot >= 50 ? (sp ? 'Back-end starter / swingman' : 'Middle reliever') : pot >= 45 ? 'Up-and-down arm' : 'Organizational depth';
  }
  return pot >= 70 ? 'All-Star' : pot >= 65 ? 'First-division regular' : pot >= 60 ? 'Above-average regular' : pot >= 55 ? 'Average regular' : pot >= 50 ? 'Platoon / utility player' : pot >= 45 ? 'Bench / up-and-down' : 'Organizational depth';
}

// File a report: tool grades as your scouts now read them, a projection and a write-up.
export function fileReport(league: League, p: Player, by: StaffRole, why: string): ScoutReport {
  const st = scouting(league);
  const prev = st.reports[p.id];
  const visits = prev && league.season - prev.season <= 1 ? Math.min(3, prev.visits + 1) : 1;
  // Record first so the read below already reflects this look.
  st.reports[p.id] = { pid: p.id, season: league.season, day: league.day, by, visits, ovr: 0, pot: 0, role: '', risk: 'Medium', tools: [], text: '', why };
  const o = scoutedOvr(league, p);
  const pot = scoutedPot(league, p);
  const s = (k: string, v: number) => scout(league, p, k, v);
  let tools: { label: string; v: number }[];
  if (isPitcher(p)) {
    const r = p.ratings.pit;
    tools = [{ label: 'Stuff', v: s('stuff', r.stuff) }, { label: 'Movement', v: s('mov', r.movement) }, { label: 'Control', v: s('ctl', r.control) }, { label: 'Stamina', v: s('stam', r.stamina) }];
    const pitches = Object.entries(r.pitches).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).slice(0, 3);
    for (const [pt, v] of pitches) tools.push({ label: PITCH[pt] ?? pt, v: s(`pitch-${pt}`, v ?? 20) });
  } else {
    const fp = p.pos === 'DH' ? null : p.pos;
    tools = [
      { label: 'Hit', v: s('vR-contact', contact(p.ratings.vR)) },
      { label: 'Power', v: s('vR-power', p.ratings.vR.power) },
      { label: 'Eye', v: s('vR-eye', p.ratings.vR.eye) },
      { label: 'Speed', v: s('spd', p.ratings.run.speed) },
      ...(fp ? [{ label: 'Field', v: s(`pos-${fp}`, posRating(p.ratings.def, fp as Exclude<typeof p.pos, 'DH' | 'SP' | 'RP'>)) }] : []),
    ];
  }
  const age = league.season - p.born;
  const gap = pot - o;
  const risk: ScoutReport['risk'] = p.level === 'MLB' && age >= 26 ? 'Low' : gap >= 20 || (p.prospect && !p.prospect.college) || p.ifa ? (age <= 19 ? 'Extreme' : 'High') : gap >= 10 ? 'High' : gap >= 5 ? 'Medium' : 'Low';
  const sorted = [...tools].sort((a, b) => b.v - a.v);
  const lc = (l: string) => l.toLowerCase();
  const strengths = sorted.filter((t) => t.v >= 55).slice(0, 2).map((t) => `${adj(t.v)} ${lc(t.label)}`);
  const weak = sorted.filter((t) => t.v <= 40).slice(-1).map((t) => `${adj(t.v)} ${lc(t.label)}`);
  const role = roleFor(p, pot);
  const pa = p.stats.filter((x) => x.season === league.season).reduce((t, x) => t + x.bat.pa + x.pit.outs, 0);
  const text = [
    strengths.length ? `Calling cards: ${strengths.join(' and ')}.` : 'No standout tool.',
    weak.length ? `Concern: ${weak[0]}.` : '',
    gap >= 8 ? `Projects as ${an(role)} ${lowerRole(role)} if it comes together (${o} now, ${pot} future).` : `What you see is what you get: ${an(role)} ${lowerRole(role)} (${o}).`,
    visits > 1 ? `Second look confirms the read.` : '',
    pa < 30 && !p.prospect && !p.ifa ? 'Small sample this year; leaning on the tools.' : '',
  ].filter(Boolean).join(' ');
  const rep: ScoutReport = { pid: p.id, season: league.season, day: league.day, by, visits, ovr: o, pot, role, risk, tools, text, why };
  st.reports[p.id] = rep;
  st.fresh.push(p.id);
  return rep;
}

// Ask for a report (next month's first look) or rush one (back in a day or two).
export function requestReport(league: League, pid: number, rush: boolean): string {
  const st = scouting(league);
  const p = league.players[pid];
  if (!p) return '';
  if (rush) {
    if (st.rush.some((r) => r.pid === pid)) return `${pname(p)} is already on the rush list.`;
    // Rushes come out of this month's looks; with the calendar full they take a bit longer.
    const busy = st.rush.length >= 6;
    st.rush.push({ pid, due: league.day + (busy ? 3 : 1) });
    if (st.plan.length) st.plan.splice(st.plan.length - 1, 1);
    return `Rushing a report on ${pname(p)}: back by ${dayShort(league.season, league.day + (busy ? 3 : 1))}.`;
  }
  if (!st.requests.includes(pid)) st.requests.push(pid);
  return `${pname(p)} is on next month's list.`;
}

export function rushMany(league: League, pids: number[]): string {
  const todo = pids.filter((id) => !recent(league, id, 30));
  todo.forEach((id) => requestReport(league, id, true));
  return todo.length ? `Rushing reports on ${todo.length} player${todo.length === 1 ? '' : 's'}: back in a day or two.` : 'You already have fresh reports on all of them.';
}

// Daily: make the looks that are due, deliver rushes, and send a weekly digest.
export function scoutingDay(league: League): void {
  const st = scouting(league);
  if (st.month !== monthKey(league)) planMonth(league);
  const due = st.plan.filter((x) => x.due <= league.day);
  st.plan = st.plan.filter((x) => x.due > league.day);
  for (const v of due) {
    const p = league.players[v.pid];
    if (p && !p.retired) fileReport(league, p, v.by, v.why);
  }
  const rushed = st.rush.filter((r) => r.due <= league.day);
  st.rush = st.rush.filter((r) => r.due > league.day);
  const rushReports: ScoutReport[] = [];
  for (const r of rushed) {
    const p = league.players[r.pid];
    if (p && !p.retired) rushReports.push(p.orgId === league.userOrgId ? fileReport(league, p, 'ICS', 'rushed: you asked for a fresh look') : fileReport(league, p, 'PRO', 'rushed for a trade you are weighing'));
  }
  if (rushReports.length) {
    st.fresh = st.fresh.filter((id) => !rushReports.some((r) => r.pid === id));
    addInbox(league, {
      from: scoutName(league, 'PRO'), subject: `Rush report${rushReports.length > 1 ? 's' : ''}: ${rushReports.map((r) => pname(league.players[r.pid])).join(', ')}`,
      kind: 'info', pids: rushReports.map((r) => r.pid), link: { page: 'scouting' },
      text: rushReports.map((r) => { const p = league.players[r.pid]; return `${posLabel(p)} ${pname(p)}: ${r.role}, ${r.risk.toLowerCase()} risk (${r.ovr}/${r.pot}). ${r.text}`; }).join(' | '),
    });
  }
  // Weekly digest of the month's regular reports, highlights first.
  if (league.day - st.lastDigest >= 7 && st.fresh.length) {
    const all = st.fresh.map((id) => st.reports[id]).filter(Boolean);
    st.fresh = [];
    st.lastDigest = league.day;
    const ours = all.filter((r) => r.by === 'ICS');
    const reps = all.filter((r) => r.by !== 'ICS');
    if (ours.length) {
      const up = ours.filter((r) => r.pot >= 50).sort((a, b) => b.pot - a.pot).slice(0, 4);
      addInbox(league, {
        from: scoutName(league, 'ICS'), subject: `Internal coverage: ${ours.length} report${ours.length === 1 ? '' : 's'} on our system`,
        kind: 'info', pids: up.map((r) => r.pid), link: { page: 'scouting', query: { tab: 'ours' } },
        text: `This week's write-ups on our own players are filed.${up.length ? ` Best of them: ${up.map((r) => `${pname(league.players[r.pid])} (${r.role.toLowerCase()}, ${r.ovr}/${r.pot})`).join('; ')}.` : ''}`,
      });
    }
    if (!reps.length) return;
    const top = [...reps].sort((a, b) => b.pot - a.pot).slice(0, 4);
    addInbox(league, {
      from: scoutName(league, 'SD'), subject: `Scouting: ${reps.length} new report${reps.length === 1 ? '' : 's'}`,
      kind: 'info', pids: top.map((r) => r.pid), link: { page: 'scouting' },
      text: `This week's reports are filed. Standouts: ${top.map((r) => `${pname(league.players[r.pid])} (${r.role.toLowerCase()}, ${r.ovr}/${r.pot})`).join('; ')}.`,
    });
  }
  // Old reports on players who left the game go.
  if (league.day % 30 === 0) for (const id of Object.keys(st.reports)) { const p = league.players[Number(id)]; if (!p || p.retired) delete st.reports[Number(id)]; }
}

export const reportOn = (league: League, p: Player): ScoutReport | undefined => league.scouting?.reports[p.id];
export const reportAgeDays = (league: League, r: ScoutReport): number => (league.season - r.season) * 365 + league.day - r.day;
export const userOrg = (league: League): Org => league.orgs[league.userOrgId];
