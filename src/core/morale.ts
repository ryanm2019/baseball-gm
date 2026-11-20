// Agents, player morale, the clubhouse, and the Inbox.
//
// Morale (0-100, 50 = content) has six parts, each weighted by the player's
// personality: role / playing time, team success, pay, how he's treated (the
// trading block, recent events), his own performance, and the clubhouse
// (leaders lift everyone; losing one hurts). It moves a little each week.
//
// Effects are small by design: about +/-2 rating points in games at the
// extremes, +/-20% development speed, and it shifts negotiations (happy
// players give a bigger hometown discount; miserable ones won't talk).
import type { Agent, InboxMsg, League, Morale, Org, Player } from './types.ts';
import { activeAt, addNews, orgPlayers, pname } from './util.ts';
import { isPitcher, ovr } from './ratings.ts';
import { marketValue, serviceYears } from './contracts.ts';
import { clamp, rand, randInt, shuffle } from './random.ts';
import { randomStaffName } from './names.ts';
import { batAdvanced, pitAdvanced, seasonCtx } from './war.ts';
import { posLabel } from './rules.ts';

// ---------- agents ----------

const FIRMS = ['Apex Sports Group', 'Summit Athlete Management', 'Diamond Line Partners', 'Northstar Baseball', 'Keystone Sports', 'Crossbar Representation', 'Ironwood Sports', 'Bluefield Talent', 'Harbor Point Sports', 'Meridian Athletes', 'Granite Peak Sports', 'Silver Fox Agency', 'Atlas Baseball Partners', 'Red Rock Sports', 'Lakeshore Athletes'];

const STYLE = {
  'Hard-liner': { discount: 0.55, inSeasonBan: 0.5, toMarket: 0.6 },
  'Market-driven': { discount: 0.8, inSeasonBan: 0.2, toMarket: 0.25 },
  'Team-friendly': { discount: 1.2, inSeasonBan: -0.3, toMarket: -0.4 },
  Loyalist: { discount: 1.1, inSeasonBan: -0.1, toMarket: -0.3 },
} as const;

export function createAgents(): Agent[] {
  const out: Agent[] = [];
  const styles = Object.keys(STYLE) as Agent['style'][];
  for (let i = 0; i < 24; i++) {
    const n = randomStaffName();
    const style = i === 0 ? 'Hard-liner' : styles[randInt(0, styles.length - 1)];
    const rep = i === 0 ? 99 : clamp(Math.round(35 + rand() * 55), 1, 95);
    out.push({ id: i, first: n.first, last: n.last, firm: i === 0 ? 'Sterling Global Sports' : FIRMS[i % FIRMS.length], reputation: rep, style, ...STYLE[style] });
  }
  return out;
}

export function ensureAgents(league: League): Agent[] {
  if (!league.agents?.length) league.agents = createAgents();
  return league.agents;
}

// Better players land with bigger agents; the super-agent takes the stars.
export function ensureAgent(league: League, p: Player): Agent {
  const agents = ensureAgents(league);
  if (p.agent !== undefined && agents[p.agent]) return agents[p.agent];
  const talent = Math.max(ovr(p), p.prospect || p.ifa ? 0 : 0);
  let pick: Agent;
  if (talent >= 62 && rand() < 0.35) pick = agents[0];
  else {
    const pool = agents.filter((a) => a.id !== 0);
    const w = pool.map((a) => Math.pow(a.reputation / 50, talent >= 55 ? 2 : 0.5));
    let r = rand() * w.reduce((x, y) => x + y, 0);
    pick = pool[pool.length - 1];
    for (let i = 0; i < pool.length; i++) { r -= w[i]; if (r <= 0) { pick = pool[i]; break; } }
  }
  p.agent = pick.id;
  return pick;
}

export const agentName = (a: Agent) => `${a.first} ${a.last} (${a.firm})`;

// ---------- morale ----------

export function moraleOf(p: Player): Morale {
  p.morale ??= { value: 55, events: [] };
  return p.morale;
}

export function moraleEvent(league: League, p: Player, delta: number, text: string): void {
  const m = moraleOf(p);
  m.events.push({ season: league.season, day: league.day, delta, text });
  if (m.events.length > 12) m.events.splice(0, m.events.length - 12);
  m.value = clamp(m.value + delta * 0.5, 0, 100);
}

export const moraleLabel = (v: number) => (v >= 80 ? 'Thrilled' : v >= 62 ? 'Happy' : v >= 45 ? 'Content' : v >= 30 ? 'Unhappy' : 'Miserable');

// Rating points added in games (small: +/-2 at the extremes).
export const moraleBoost = (p: Player): number => (p.morale ? clamp((p.morale.value - 50) / 25, -2, 2) : 0);

// Development multiplier (+/-20% at the extremes).
export const moraleDev = (p: Player): number => (p.morale ? 1 + clamp((p.morale.value - 50) / 250, -0.2, 0.2) : 1);

function teamGames(league: League, orgId: number): number {
  const st = league.standings.MLB?.[orgId];
  return st ? st.w + st.l : 0;
}

function decayed(league: League, m: Morale): number {
  let t = 0;
  for (const e of m.events) {
    const age = (league.season - e.season) * 365 + (league.day - e.day);
    if (age < 0 || age > 120) continue;
    t += e.delta * Math.pow(0.5, age / 30);
  }
  return t;
}

// Expected role from where he ranks on his club.
function roleParts(league: League, org: Org, p: Player): number {
  const season = league.season;
  const g = teamGames(league, org.id);
  const mlb = activeAt(league, org.id, 'MLB');
  if (p.level === 'MLB') {
    if (g < 10) return 0;
    const e = p.stats.find((s) => s.season === season && s.level === 'MLB' && s.orgId === org.id);
    if (!isPitcher(p)) {
      const rank = mlb.filter((x) => !isPitcher(x)).sort((a, b) => ovr(b) - ovr(a)).indexOf(p);
      const expected = rank < 9 ? 0.8 : rank < 12 ? 0.35 : 0.15;
      const actual = (e?.bat.pa ?? 0) / (g * 4.1);
      return clamp((actual - expected) * 35, -18, 8);
    }
    if (p.pos === 'SP') {
      const rank = mlb.filter((x) => x.pos === 'SP').sort((a, b) => ovr(b) - ovr(a)).indexOf(p);
      const expected = rank < 5 ? 0.85 : 0.3;
      const actual = (e?.pit.gs ?? 0) / Math.max(1, g / 5);
      return clamp((actual - expected) * 25, -15, 6);
    }
    return 0;
  }
  // A 40-man player who thinks he belongs in the majors.
  if (p.on40 && p.level === 'AAA' && league.season - p.born >= 25) {
    const worst = mlb.filter((x) => isPitcher(x) === isPitcher(p)).map(ovr).sort((a, b) => a - b)[0] ?? 99;
    if (ovr(p) >= worst + 3) return -10;
  }
  return 0;
}

function payPart(league: League, p: Player): number {
  if (p.contract.type !== 'ML') return 0;
  const svc = serviceYears(p.mlServiceDays, league.settings);
  const mv = marketValue(p, league.settings);
  const ratio = p.contract.salary / Math.max(league.settings.minSalary, mv);
  const greed = p.personality.greed / 50;
  if (svc < 3) return ratio < 0.3 && ovr(p) >= 58 ? -4 * greed : 0; // underpaid young star
  return clamp((ratio - 1) * 12 * greed, -12, 6);
}

function perfPart(league: League, p: Player): number {
  const e = p.stats.find((s) => s.season === league.season && s.level === p.level);
  if (!e || !p.level) return 0;
  const ctx = seasonCtx(league, league.season, p.level);
  if (isPitcher(p)) return e.pit.outs >= 60 ? clamp((100 - pitAdvanced(e.pit, ctx).fipMinus) / 6, -8, 8) : 0;
  return e.bat.pa >= 80 ? clamp((batAdvanced(e.bat, ctx).wrcPlus - 100) / 6, -8, 8) : 0;
}

// Leaders set the tone: their morale spreads (positive or negative).
export function clubhouse(league: League, orgId: number): number {
  const mlb = activeAt(league, orgId, 'MLB');
  let num = 0;
  let den = 0;
  for (const x of mlb) {
    const w = Math.max(0, x.personality.leadership - 40) / 40;
    if (!w) continue;
    num += w * ((x.morale?.value ?? 55) - 50);
    den += w;
  }
  return den ? clamp(num / den / 5, -5, 5) : 0;
}

export function updateMorale(league: League, p: Player): void {
  if (p.orgId === null || p.retired) return;
  const org = league.orgs[p.orgId];
  const m = moraleOf(p);
  const st = league.standings.MLB?.[org.id];
  const pct = st && st.w + st.l >= 10 ? st.w / (st.w + st.l) : 0.5;
  const winW = p.personality.winning / 50;
  const parts = {
    role: roleParts(league, org, p),
    team: p.level === 'MLB' ? clamp((pct - 0.5) * 50 * winW, -10, 10) : 0,
    pay: payPart(league, p),
    treatment: (org.block.includes(p.id) ? -5 * (1 + (p.personality.loyalty - 50) / 60) : 0),
    performance: perfPart(league, p),
    clubhouse: p.level === 'MLB' ? clubhouse(league, org.id) : 0,
  };
  m.parts = parts;
  const target = clamp(58 + parts.role + parts.team + parts.pay + parts.treatment + parts.performance + parts.clubhouse + decayed(league, m), 0, 100);
  // Moves toward the target, not all at once.
  m.value = clamp(m.value + (target - m.value) * 0.35, 0, 100);
}

// Trading away a respected leader stings the room.
export function leaderTraded(league: League, p: Player, fromOrg: number): void {
  if (p.personality.leadership < 68 || p.level !== 'MLB') return;
  const hit = (p.morale?.value ?? 55) >= 55 ? -6 : -3;
  for (const x of activeAt(league, fromOrg, 'MLB')) if (x.id !== p.id) moraleEvent(league, x, hit, `Lost a clubhouse leader (${pname(p)})`);
  if (fromOrg === league.userOrgId) addNews(league, fromOrg, `Your clubhouse took the trade of ${pname(p)} hard: he was one of the team's leaders.`, [p.id]);
}

// ---------- the Inbox ----------

export function addInbox(league: League, msg: Omit<InboxMsg, 'id' | 'season' | 'day'>): InboxMsg {
  league.inbox ??= [];
  const m: InboxMsg = { id: league.nextId.news++, season: league.season, day: league.day, ...msg };
  league.inbox.push(m);
  if (league.inbox.length > 200) league.inbox.splice(0, league.inbox.length - 200);
  return m;
}

export const unreadInbox = (league: League) => (league.inbox ?? []).filter((m) => !m.read).length;

// One open request per player and kind, and at least 45 days between them.
const hasOpen = (league: League, pid: number, kind: InboxMsg['kind']) =>
  (league.inbox ?? []).some((m) => m.pids.includes(pid) && m.kind === kind && ((!m.resolved && league.season === m.season) || (m.season === league.season && league.day - m.day < 45)));

// Weekly: agents of unhappy players reach out.
function agentMessages(league: League): void {
  const user = league.userOrgId;
  for (const p of orgPlayers(league, user)) {
    const m = p.morale;
    if (!m?.parts || !p.on40) continue;
    const a = ensureAgent(league, p);
    const from = `Agent ${agentName(a)}`;
    if (m.value < 22 && ovr(p) >= 48 && !hasOpen(league, p.id, 'trade-request') && rand() < 0.5) {
      addInbox(league, {
        from, subject: `${pname(p)} requests a trade`, kind: 'trade-request', pids: [p.id], stop: true,
        text: `My client ${posLabel(p)} ${pname(p)} is miserable and has asked me to request a trade. He'd like this handled quietly.`,
        actions: [{ key: 'block', label: 'Put him on the trading block' }, { key: 'promise-trade', label: 'Promise to trade him within 30 days' }, { key: 'refuse', label: 'Refuse' }],
      });
    } else if (m.parts.role <= -8 && p.level === 'MLB' && !hasOpen(league, p.id, 'role') && rand() < 0.25) {
      addInbox(league, {
        from, subject: `${pname(p)} wants a bigger role`, kind: 'role', pids: [p.id],
        text: `${pname(p)} doesn't understand why he's not playing more. He's ready to contribute every day.`,
        actions: [{ key: 'promise-pt', label: 'Promise more playing time' }, { key: 'explain', label: 'Explain his role' }, { key: 'ignore', label: 'Ignore' }],
      });
    } else if (m.parts.role <= -8 && p.level === 'AAA' && !hasOpen(league, p.id, 'callup') && rand() < 0.25) {
      addInbox(league, {
        from, subject: `${pname(p)} wants a call-up`, kind: 'callup', pids: [p.id],
        text: `${pname(p)} has nothing left to prove in Triple-A. He wants a shot in the majors, or a trade to a team that will give him one.`,
        actions: [{ key: 'promise-callup', label: 'Promise a call-up within 30 days' }, { key: 'explain', label: 'Tell him to keep working' }, { key: 'block', label: 'Put him on the trading block' }],
      });
    } else if (league.phase !== 'regular' && serviceYears(p.mlServiceDays, league.settings) >= 2 && ovr(p) >= 60 && m.value >= 60 && !hasOpen(league, p.id, 'extension') && rand() < 0.08) {
      addInbox(league, {
        from, subject: `${pname(p)} open to an extension`, kind: 'extension', pids: [p.id],
        text: `${pname(p)} loves it here. If you want to talk about a long-term deal, we're listening.`,
        actions: [{ key: 'talk', label: 'Open talks' }, { key: 'later', label: 'Not right now' }],
        link: { page: 'negotiate', args: ['ext', p.id] },
      });
    }
  }
}

// What happens when you pick a reply.
export function answerInbox(league: League, msg: InboxMsg, key: string): string {
  const p = msg.pids.length ? league.players[msg.pids[0]] : undefined;
  const label = msg.actions?.find((a) => a.key === key)?.label ?? key;
  msg.resolved = label;
  msg.read = true;
  if (!p) return label;
  const due = league.day + 30;
  league.promises ??= [];
  const org = league.orgs[league.userOrgId];
  switch (key) {
    case 'promise-pt': league.promises.push({ pid: p.id, kind: 'playing-time', made: league.day, due, season: league.season }); moraleEvent(league, p, 6, 'Promised more playing time'); return 'You promised him more playing time. He expects to see it within 30 days.';
    case 'promise-callup': league.promises.push({ pid: p.id, kind: 'callup', made: league.day, due, season: league.season }); moraleEvent(league, p, 6, 'Promised a call-up'); return 'You promised a call-up within 30 days.';
    case 'promise-trade': league.promises.push({ pid: p.id, kind: 'trade', made: league.day, due, season: league.season }); if (!org.block.includes(p.id)) org.block.push(p.id); moraleEvent(league, p, 5, 'Promised a trade'); return 'You promised to trade him within 30 days. He is on your trading block.';
    case 'block': if (!org.block.includes(p.id)) org.block.push(p.id); moraleEvent(league, p, 4, 'Put on the block at his request'); return 'He is on your trading block.';
    case 'explain': moraleEvent(league, p, rand() < 0.5 ? 2 : -2, 'Talked about his role'); return 'You talked with him about his role.';
    case 'ignore': moraleEvent(league, p, -4, 'Request ignored'); return 'You ignored the request.';
    case 'refuse': {
      moraleEvent(league, p, -10, 'Trade request refused');
      if (p.personality.leadership >= 65) for (const x of activeAt(league, org.id, 'MLB')) if (x.id !== p.id) moraleEvent(league, x, -1, `Clubhouse tension (${pname(p)})`);
      return 'You refused. He is not happy, and it may spread.';
    }
    case 'talk': return 'Open the negotiation from the link.';
    case 'later': moraleEvent(league, p, -1, 'Extension talks put off'); return 'Maybe later.';
  }
  return label;
}

// Promises come due.
function checkPromises(league: League): void {
  const keep: typeof league.promises = [];
  for (const pr of league.promises ?? []) {
    const p = league.players[pr.pid];
    if (!p || pr.season !== league.season && league.phase !== 'offseason') continue;
    let kept: boolean | null = null;
    if (pr.kind === 'trade') kept = p.orgId !== league.userOrgId ? true : league.day >= pr.due ? false : null;
    else if (pr.kind === 'callup') kept = p.level === 'MLB' ? true : league.day >= pr.due ? false : null;
    else if (league.day >= pr.due) kept = (p.morale?.parts?.role ?? -10) > -5;
    if (kept === null) { keep.push(pr); continue; }
    if (p.orgId !== league.userOrgId) continue;
    if (kept) moraleEvent(league, p, 6, 'Promise kept');
    else {
      moraleEvent(league, p, -15, 'Broken promise');
      addInbox(league, { from: `Agent ${agentName(ensureAgent(league, p))}`, subject: `You broke your promise to ${pname(p)}`, kind: 'info', pids: [p.id], text: `${pname(p)} feels you broke your word. That won't be forgotten soon.` });
    }
  }
  league.promises = keep;
}

// Weekly: morale for every 40-man player in the league, agent messages for yours.
export function moraleWeek(league: League): void {
  ensureAgents(league);
  const players = Object.values(league.players).filter((p) => p.orgId !== null && (p.on40 || p.level === 'MLB'));
  // Leaders first so the clubhouse reads this week's mood.
  players.sort((a, b) => b.personality.leadership - a.personality.leadership);
  for (const p of players) {
    ensureAgent(league, p);
    updateMorale(league, p);
  }
  checkPromises(league);
  if (league.phase === 'regular' || league.phase === 'preseason' || league.phase === 'offseason') agentMessages(league);
  // AI clubs deal with their own miserable players: shop them.
  for (const org of league.orgs) {
    if (org.id === league.userOrgId) continue;
    for (const p of shuffle(orgPlayers(league, org.id).filter((x) => (x.morale?.value ?? 55) < 22 && x.level === 'MLB')).slice(0, 1)) if (!org.block.includes(p.id)) org.block.push(p.id);
  }
}

// The sim pauses for important Inbox messages (once each).
export function inboxStop(league: League): string | null {
  const m = (league.inbox ?? []).find((x) => x.stop && !x.stopped && !x.resolved);
  if (!m) return null;
  m.stopped = true;
  return `Inbox: ${m.subject}. Answer it on the Inbox page, then press Play to continue.`;
}
