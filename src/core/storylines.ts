// Storylines, in the spirit of OOTP: random events that run alongside the
// sim and change players: breakouts and busts, new pitches and swing changes,
// hot streaks, slumps and the yips, contract-year pushes, milestone chases,
// mentors, freak injuries, suspensions, age controversies, clubhouse fights
// (you decide what to do) and, if enabled, career-ending events.
//
// Temporary effects are stored on the player (storyFx) and wear off.
import type { InboxMsg, League, Player } from './types.ts';
import { isPitcher, ovr, potOvr } from './ratings.ts';
import { activeAt, addNews, pname, touchRosters } from './util.ts';
import { clamp, rand, randInt } from './random.ts';
import { serviceYears } from './contracts.ts';
import { posLabel, releasePlayer } from './rules.ts';
import { addInbox, moraleEvent } from './morale.ts';
import { retire } from './offseason.ts';
import { staffOf } from './staff.ts';

const RATE = { off: 0, rare: 2, normal: 5, frequent: 10 } as const; // stories per week, league-wide

const absDay = (league: League) => league.season * 400 + league.day;

// ---------- rating changes ----------

type Key = 'bat' | 'power' | 'contact' | 'eye' | 'stuff' | 'control' | 'movement' | 'speed' | 'stamina';

function bump(p: Player, key: Key, amt: number): void {
  const r = p.ratings;
  const sides = [r.vL, r.vR];
  const c = (x: number) => clamp(x + amt, 15, 85);
  switch (key) {
    case 'bat': for (const s of sides) { s.avoidK = c(s.avoidK); s.eye = c(s.eye); s.power = c(s.power); s.babip = c(s.babip); s.gap = c(s.gap); } break;
    case 'power': for (const s of sides) s.power = c(s.power); break;
    case 'contact': for (const s of sides) { s.avoidK = c(s.avoidK); s.babip = c(s.babip); } break;
    case 'eye': for (const s of sides) s.eye = c(s.eye); break;
    case 'stuff': r.pit.stuff = c(r.pit.stuff); break;
    case 'control': r.pit.control = c(r.pit.control); break;
    case 'movement': r.pit.movement = c(r.pit.movement); break;
    case 'speed': r.run.speed = c(r.run.speed); break;
    case 'stamina': r.pit.stamina = c(r.pit.stamina); break;
  }
}

// A temporary change that wears off after `days`.
function temp(league: League, p: Player, text: string, days: number, add: Partial<Record<Key, number>>): void {
  for (const [k, v] of Object.entries(add)) bump(p, k as Key, v!);
  p.storyFx = [...(p.storyFx ?? []), { text, until: absDay(league) + days, add: add as Record<string, number> }];
}

function bumpPot(p: Player, amt: number): void {
  const c = (x: number) => clamp(x + amt, 20, 85);
  if (isPitcher(p)) { p.pot.stuff = c(p.pot.stuff); p.pot.movement = c(p.pot.movement); p.pot.control = c(p.pot.control); }
  else { const b = p.pot.bat; b.avoidK = c(b.avoidK); b.eye = c(b.eye); b.power = c(b.power); b.babip = c(b.babip); b.gap = c(b.gap); }
}

export function expireStoryFx(league: League): void {
  const now = absDay(league);
  for (const p of Object.values(league.players)) {
    if (!p.storyFx?.length) continue;
    const keep = [];
    for (const fx of p.storyFx) {
      if (fx.until > now && !p.retired) { keep.push(fx); continue; }
      for (const [k, v] of Object.entries(fx.add)) bump(p, k as Key, -v);
    }
    p.storyFx = keep.length ? keep : undefined;
  }
}

function injure(p: Player, name: string, days: number): void {
  if (p.injury && p.injury.daysLeft >= days) return;
  p.injury = { name, daysLeft: days, totalDays: days };
}

// ---------- the stories ----------

interface Story {
  id: string;
  weight: number;
  when?: (league: League) => boolean;
  who: (league: League, p: Player) => boolean;
  run: (league: League, p: Player) => { title: string; text: string } | null;
  harsh?: boolean;
}

const inSeason = (l: League) => l.phase === 'regular';
const winter = (l: League) => l.phase === 'offseason' || l.phase === 'preseason';
const age = (l: League, p: Player) => l.season - p.born;
const team = (l: League, p: Player) => (p.orgId !== null ? l.orgs[p.orgId].affiliates.MLB.name : 'free agent');
const PITCHES = ['SL', 'SW', 'CB', 'CH', 'SP', 'CT', 'SI'] as const;

const STORIES: Story[] = [
  {
    id: 'new-pitch', weight: 3, when: winter,
    who: (l, p) => isPitcher(p) && p.orgId !== null && age(l, p) <= 31 && (p.level === 'MLB' || p.level === 'AAA' || p.level === 'AA'),
    run: (l, p) => {
      const have = Object.keys(p.ratings.pit.pitches);
      const add = PITCHES.find((x) => !have.includes(x));
      if (!add) return null;
      const good = rand() < 0.55;
      p.ratings.pit.pitches[add] = good ? randInt(52, 62) : randInt(38, 47);
      if (good) bump(p, 'stuff', 2);
      return { title: `${pname(p)} adds a pitch`, text: `${posLabel(p)} ${pname(p)} (${team(l, p)}) spent the winter learning a ${({ SL: 'slider', SW: 'sweeper', CB: 'curveball', CH: 'changeup', SP: 'splitter', CT: 'cutter', SI: 'sinker' } as Record<string, string>)[add]}. ${good ? 'Early reports are glowing.' : "It's a work in progress."}` };
    },
  },
  {
    id: 'swing-change', weight: 3, when: winter,
    who: (l, p) => !isPitcher(p) && p.orgId !== null && age(l, p) <= 32 && (p.level === 'MLB' || p.level === 'AAA'),
    run: (l, p) => {
      const r = rand();
      if (r < 0.5) { bump(p, 'power', 4); bump(p, 'contact', -1); }
      else if (r > 0.8) { bump(p, 'power', -2); bump(p, 'contact', -2); }
      return { title: `${pname(p)} rebuilds his swing`, text: `${pname(p)} (${team(l, p)}) overhauled his swing this winter to lift the ball. ${r < 0.5 ? 'The early results: more power.' : r > 0.8 ? 'So far it has backfired.' : 'Too soon to tell.'}` };
    },
  },
  {
    id: 'best-shape', weight: 2, when: (l) => l.phase === 'preseason',
    who: (_l, p) => p.level === 'MLB',
    run: (l, p) => {
      const real = rand() < 0.3;
      if (real) { bump(p, 'speed', 2); if (isPitcher(p)) bump(p, 'stamina', 3); }
      return { title: 'Best shape of his life', text: `${pname(p)} reported to ${team(l, p)} camp in the best shape of his life.${real ? ' This time it might be true.' : ''}` };
    },
  },
  {
    id: 'late-bloomer', weight: 2,
    who: (l, p) => p.orgId !== null && !!p.level && p.level !== 'MLB' && age(l, p) >= 22 && age(l, p) <= 26 && potOvr(p) < 60,
    run: (l, p) => { bumpPot(p, randInt(4, 7)); return { title: `${pname(p)} turns heads`, text: `Scouts are revising their reports on ${posLabel(p)} ${pname(p)} (${team(l, p)} system): at ${age(l, p)}, something has clicked.` }; },
  },
  {
    id: 'bust', weight: 2,
    who: (l, p) => p.orgId !== null && !!p.level && p.level !== 'MLB' && age(l, p) <= 24 && potOvr(p) >= 55,
    run: (l, p) => { bumpPot(p, -randInt(4, 7)); return { title: `Concerns about ${pname(p)}`, text: `Evaluators are souring on ${posLabel(p)} ${pname(p)} (${team(l, p)} system). The tools haven't translated.` }; },
  },
  {
    id: 'hot-streak', weight: 3, when: inSeason,
    who: (_l, p) => p.level === 'MLB' && !p.storyFx?.length,
    run: (l, p) => { temp(l, p, 'Hot streak', randInt(14, 21), isPitcher(p) ? { stuff: 3, control: 2 } : { bat: 3 }); return { title: `${pname(p)} is locked in`, text: `${pname(p)} (${team(l, p)}) says he's seeing the ball as well as he ever has.` }; },
  },
  {
    id: 'slump', weight: 3, when: inSeason,
    who: (_l, p) => p.level === 'MLB' && !p.storyFx?.length,
    run: (l, p) => { temp(l, p, 'Slump', randInt(14, 21), isPitcher(p) ? { stuff: -3, control: -2 } : { bat: -3 }); return { title: `${pname(p)} scuffling`, text: `${pname(p)} (${team(l, p)}) is in a funk and working overtime with the coaches to get out of it.` }; },
  },
  {
    id: 'yips', weight: 1, when: inSeason,
    who: (_l, p) => isPitcher(p) && p.level === 'MLB' && !p.storyFx?.length,
    run: (l, p) => {
      // A good pitching coach gets him back sooner.
      const pc = p.orgId !== null ? staffOf(l, l.orgs[p.orgId], 'PC') : undefined;
      const days = Math.round(randInt(25, 60) * (pc ? 1.3 - pc.evaluation / 130 : 1));
      temp(l, p, 'The yips', days, { control: -9 });
      return { title: `${pname(p)} has lost the zone`, text: `${pname(p)} (${team(l, p)}) can't find the strike zone. The pitching staff is working with him; there's no timetable.` };
    },
  },
  {
    id: 'contract-year', weight: 2, when: (l) => inSeason(l) && l.day < 60,
    who: (l, p) => p.level === 'MLB' && p.contract.type === 'ML' && p.contract.exp === l.season && serviceYears(p.mlServiceDays, l.settings) >= 5 && !p.storyFx?.length,
    run: (l, p) => { temp(l, p, 'Contract year', 200, isPitcher(p) ? { stuff: 2, control: 1 } : { bat: 2 }); return { title: `${pname(p)} playing for a contract`, text: `${pname(p)} (${team(l, p)}), headed for free agency, showed up determined to cash in.` }; },
  },
  {
    id: 'milestone', weight: 4, when: inSeason,
    who: (_l, p) => p.level === 'MLB',
    run: (l, p) => {
      const mlb = p.stats.filter((s) => s.level === 'MLB');
      const hr = mlb.reduce((t, s) => t + s.bat.hr, 0);
      const h = mlb.reduce((t, s) => t + s.bat.h, 0);
      const k = mlb.reduce((t, s) => t + s.pit.k, 0);
      const w = mlb.reduce((t, s) => t + s.pit.w, 0);
      const near = [[hr, 500, 'home runs'], [hr, 400, 'home runs'], [h, 3000, 'hits'], [h, 2000, 'hits'], [k, 3000, 'strikeouts'], [w, 300, 'wins'], [w, 200, 'wins']] as const;
      const m = near.find(([v, goal]) => v < goal && goal - v <= (goal >= 1000 ? 60 : 15));
      if (!m) return null;
      moraleEvent(l, p, 3, `Chasing ${m[1]} ${m[2]}`);
      return { title: `${pname(p)} chases ${m[1]}`, text: `${pname(p)} (${team(l, p)}) is ${m[1] - m[0]} ${m[2]} away from ${m[1]}.` };
    },
  },
  {
    id: 'mentor', weight: 2,
    who: (l, p) => p.level === 'MLB' && p.personality.leadership >= 70 && age(l, p) >= 31,
    run: (l, p) => {
      const kids = Object.values(l.players).filter((x) => x.orgId === p.orgId && x.level && x.level !== 'MLB' && age(l, x) <= 23 && isPitcher(x) === isPitcher(p) && potOvr(x) >= 52);
      const kid = kids[Math.floor(rand() * kids.length)];
      if (!kid) return null;
      bumpPot(kid, 2);
      kid.personality.workEthic = clamp(kid.personality.workEthic + 8, 1, 100);
      moraleEvent(l, kid, 5, `Mentored by ${pname(p)}`);
      return { title: `${pname(p)} takes ${pname(kid)} under his wing`, text: `Veteran ${pname(p)} has taken prospect ${posLabel(kid)} ${pname(kid)} under his wing. The ${team(l, p)} love the work ethic rubbing off.` };
    },
  },
  {
    id: 'community', weight: 1, when: (l) => inSeason(l) && l.day > 150,
    who: (_l, p) => p.level === 'MLB' && p.personality.leadership >= 60,
    run: (l, p) => { moraleEvent(l, p, 8, 'Community Service Award'); p.personality.loyalty = clamp(p.personality.loyalty + 6, 1, 100); return { title: `${pname(p)} honored`, text: `${pname(p)} (${team(l, p)}) received the league's Community Service Award for his work off the field.` }; },
  },
  {
    id: 'freak-injury', weight: 3, when: (l) => inSeason(l) || l.phase === 'preseason',
    who: (_l, p) => p.level === 'MLB' && !p.injury,
    run: (l, p) => {
      const what = ['strained his back carrying luggage', 'cut his hand opening a package', 'hurt his wrist changing a tire', 'slipped in the shower', 'was bitten by the family dog', 'burned his hand at a barbecue', 'tweaked his neck sleeping on a flight', 'injured his ankle stepping off a curb', 'strained an oblique sneezing'][randInt(0, 8)];
      const days = randInt(4, 25);
      injure(p, 'Off-field injury', days);
      return { title: 'Freak injury', text: `${pname(p)} (${team(l, p)}) ${what} and will miss about ${days} days.` };
    },
  },
  {
    id: 'paternity', weight: 2, when: inSeason,
    who: (l, p) => p.level === 'MLB' && !p.injury && age(l, p) >= 24,
    run: (l, p) => { injure(p, 'Paternity list', 3); moraleEvent(l, p, 6, 'Became a father'); return { title: `Congratulations, ${pname(p)}`, text: `${pname(p)} (${team(l, p)}) left the team to be with his wife for the birth of their child.` }; },
  },
  {
    id: 'visa', weight: 2, when: (l) => l.phase === 'preseason',
    who: (_l, p) => (p.level === 'MLB' || p.level === 'AAA') && !!p.country && p.country !== 'USA' && p.country !== 'United States',
    run: (l, p) => { injure(p, 'Visa delay', randInt(7, 18)); return { title: 'Visa delay', text: `${pname(p)} (${team(l, p)}) is stuck in ${p.country} waiting on his work visa and will be late to camp.` }; },
  },
  {
    id: 'age', weight: 0.35,
    who: (l, p) => p.orgId !== null && !!p.level && p.level !== 'MLB' && age(l, p) <= 21 && !!p.country && p.country !== 'USA' && p.country !== 'United States',
    run: (l, p) => {
      const yrs = randInt(1, 3);
      p.born -= yrs;
      bumpPot(p, -2 - yrs);
      return { title: 'Age controversy', text: `An investigation found that ${pname(p)} (${team(l, p)} system) is ${yrs} year${yrs === 1 ? '' : 's'} older than listed. He's actually ${age(l, p)}. Scouts are lowering expectations.` };
    },
  },
  {
    id: 'ped', weight: 0.5, harsh: true, when: (l) => l.phase !== 'playoffs',
    who: (_l, p) => p.orgId !== null && (p.level === 'MLB' || p.level === 'AAA') && ovr(p) >= 45,
    run: (l, p) => {
      injure(p, 'Suspended: performance-enhancing drugs (80 games)', 88);
      moraleEvent(l, p, -15, 'PED suspension');
      if (p.orgId !== null) for (const x of activeAt(l, p.orgId, 'MLB')) if (x.id !== p.id) moraleEvent(l, x, -2, `Teammate suspended (${pname(p)})`);
      return { title: `${pname(p)} suspended 80 games`, text: `${posLabel(p)} ${pname(p)} (${team(l, p)}) was suspended 80 games after testing positive for a performance-enhancing substance.` };
    },
  },
  {
    id: 'career-ending', weight: 0.3, harsh: true,
    who: (l, p) => p.orgId !== null && !!p.level && (age(l, p) <= 24 || p.level === 'MLB'),
    run: (l, p) => {
      if (!l.settings.careerEndingStories) return null;
      const young = age(l, p) <= 24 && p.level !== 'MLB';
      const why = young
        ? ['has decided to leave baseball to play college football', 'has walked away from the game to join the military', 'has retired to take over the family business'][randInt(0, 2)]
        : 'has retired after doctors advised him not to continue following repeated concussions';
      const org = p.orgId!;
      const name = team(l, p);
      retire(l, p);
      touchRosters();
      void org;
      return { title: `${pname(p)} retires`, text: `${posLabel(p)} ${pname(p)} (${name}${young ? ' system' : ''}) ${why}.` };
    },
  },
];

// ---------- clubhouse fight (interactive for your club) ----------

function clubhouseFight(league: League): { title: string; text: string; pids: number[]; orgId: number } | null {
  const org = league.orgs[Math.floor(rand() * league.orgs.length)];
  const mlb = activeAt(league, org.id, 'MLB');
  if (mlb.length < 2) return null;
  const a = mlb.filter((p) => (p.morale?.value ?? 55) < 45)[0] ?? mlb[randInt(0, mlb.length - 1)];
  const b = mlb.filter((p) => p.id !== a.id)[randInt(0, mlb.length - 2)];
  const text = `${pname(a)} and ${pname(b)} had to be separated after a heated dugout confrontation (${org.affiliates.MLB.name}).`;
  if (org.id === league.userOrgId) {
    addInbox(league, {
      from: 'Manager', subject: `Dugout fight: ${pname(a)} and ${pname(b)}`, kind: 'story', pids: [a.id, b.id], stop: true, storyId: 'fight',
      text: `${text} ${pname(a)} started it. How do you want to handle him?`,
      actions: [{ key: 'nothing', label: 'Do nothing' }, { key: 'suspend', label: 'Suspend him 5 days' }, { key: 'block', label: 'Put him on the trading block' }, { key: 'release', label: 'Release him' }],
    });
  } else {
    // AI clubs usually suspend.
    injure(a, 'Suspended by the team', 5);
    moraleEvent(league, a, -6, 'Suspended for a fight');
  }
  moraleEvent(league, b, -3, `Fight with ${pname(a)}`);
  return { title: 'Dugout fight', text, pids: [a.id, b.id], orgId: org.id };
}

// Your answer to an interactive story.
export function answerStory(league: League, msg: InboxMsg, key: string): string | null {
  if (msg.storyId !== 'fight') return null;
  const a = league.players[msg.pids[0]];
  const org = league.orgs[league.userOrgId];
  msg.resolved = msg.actions?.find((x) => x.key === key)?.label ?? key;
  msg.read = true;
  if (!a || a.orgId !== org.id) return 'He is no longer with the club.';
  const room = (d: number, why: string) => { for (const x of activeAt(league, org.id, 'MLB')) if (x.id !== a.id) moraleEvent(league, x, d, why); };
  switch (key) {
    case 'nothing': moraleEvent(league, a, 2, 'No punishment for the fight'); room(-2, 'Fight went unpunished'); return 'You let it go. Some in the clubhouse think he got away with one.';
    case 'suspend': injure(a, 'Suspended by the team', 5); moraleEvent(league, a, -8, 'Suspended for a fight'); room(2, 'Discipline restored'); return 'He is suspended 5 days. The clubhouse respects the decision.';
    case 'block': if (!org.block.includes(a.id)) org.block.push(a.id); moraleEvent(league, a, -5, 'Shopped after a fight'); return 'He is on the trading block.';
    case 'release': releasePlayer(league, a); room(1, 'Discipline restored'); return 'You released him.';
  }
  return null;
}

// ---------- weekly ----------

export function storylinesWeek(league: League): void {
  expireStoryFx(league);
  const mode = league.settings.storylines ?? 'normal';
  const rate = RATE[mode];
  if (!rate) return;
  const pool = Object.values(league.players).filter((p) => !p.retired && p.orgId !== null && !p.prospect && !p.ifa);
  const n = Math.max(0, Math.round(rate * (0.6 + rand() * 0.8)));
  for (let k = 0; k < n; k++) {
    // A dugout fight every few weeks in season.
    if (league.phase === 'regular' && rand() < 0.06) {
      const f = clubhouseFight(league);
      if (f) log(league, f.title, f.text, f.pids, f.orgId);
      continue;
    }
    const live = STORIES.filter((s) => (!s.when || s.when(league)) && (!s.harsh || mode !== 'rare' || rand() < 0.5));
    const tot = live.reduce((t, s) => t + s.weight, 0);
    let r = rand() * tot;
    let story = live[live.length - 1];
    for (const s of live) { r -= s.weight; if (r <= 0) { story = s; break; } }
    if (!story) continue;
    for (let tries = 0; tries < 25; tries++) {
      const p = pool[Math.floor(rand() * pool.length)];
      if (!p || p.retired || !story.who(league, p)) continue;
      const orgId = p.orgId;
      const out = story.run(league, p);
      if (out) log(league, out.title, out.text, [p.id], orgId);
      break;
    }
  }
}

function log(league: League, title: string, text: string, pids: number[], orgId: number | null): void {
  league.stories ??= [];
  league.stories.push({ id: league.nextId.news++, season: league.season, day: league.day, title, text, pids, orgId });
  if (league.stories.length > 300) league.stories.splice(0, league.stories.length - 300);
  addNews(league, orgId === league.userOrgId ? orgId : null, text, pids);
  if (orgId === league.userOrgId && !(league.inbox ?? []).some((m) => m.day === league.day && m.season === league.season && m.subject.includes(title))) {
    addInbox(league, { from: 'Media relations', subject: title, kind: 'story', pids, text });
  }
}
