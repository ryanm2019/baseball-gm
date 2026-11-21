import { useEffect, useRef, useState } from 'react';
import { useStore, sim, requestStop, setMessage, startLive, changed } from './store.ts';
import { advanceDraft } from './core/draft.ts';
import TopSearch from './ui/TopSearch.tsx';
import { unreadInbox } from './core/morale.ts';
import type { ReactNode } from 'react';
import { useRoute, href, go } from './router.ts';
import { dayLabel } from './core/settings.ts';
import type { League } from './core/types.ts';
import Home from './ui/pages/Home.tsx';
import Dashboard from './ui/pages/Dashboard.tsx';
import Roster from './ui/pages/Roster.tsx';
import PlayerPage from './ui/pages/Player.tsx';
import Standings from './ui/pages/Standings.tsx';
import Stats from './ui/pages/Stats.tsx';
import Transactions from './ui/pages/Transactions.tsx';
import Depth from './ui/pages/Depth.tsx';
import RosterBoard from './ui/pages/RosterBoard.tsx';
import Extensions from './ui/pages/Extensions.tsx';
import Negotiate from './ui/pages/Negotiate.tsx';
import Inbox from './ui/pages/Inbox.tsx';
import Storylines from './ui/pages/Storylines.tsx';
import Awards from './ui/pages/Awards.tsx';
import History from './ui/pages/History.tsx';
import Finances from './ui/pages/Finances.tsx';
import TradeFinder from './ui/pages/TradeFinder.tsx';
import PlayoffRoster from './ui/pages/PlayoffRoster.tsx';
import Compare from './ui/pages/Compare.tsx';
import Farm from './ui/pages/Farm.tsx';
import Staff from './ui/pages/Staff.tsx';
import Schedule from './ui/pages/Schedule.tsx';
import Scores from './ui/pages/Scores.tsx';
import Box from './ui/pages/Box.tsx';
import Payroll from './ui/pages/Payroll.tsx';
import LeaguePayrolls from './ui/pages/LeaguePayrolls.tsx';
import FreeAgents from './ui/pages/FreeAgents.tsx';
import Waivers from './ui/pages/Waivers.tsx';
import Injuries from './ui/pages/Injuries.tsx';
import Playoffs from './ui/pages/Playoffs.tsx';
import SettingsPage from './ui/pages/Settings.tsx';
import News from './ui/pages/News.tsx';
import Prospects from './ui/pages/Prospects.tsx';
import Offseason from './ui/pages/Offseason.tsx';
import Tenders from './ui/pages/Tenders.tsx';
import Rule5 from './ui/pages/Rule5.tsx';
import International from './ui/pages/International.tsx';
import Draft from './ui/pages/Draft.tsx';
import { nextEvent } from './core/offseason.ts';
import Trade from './ui/pages/Trade.tsx';
import TradingBlock from './ui/pages/TradingBlock.tsx';
import TradeOffers from './ui/pages/TradeOffers.tsx';
import TradeMarket from './ui/pages/TradeMarket.tsx';
import Moves, { MoveDetail } from './ui/pages/Moves.tsx';
import Live from './ui/pages/Live.tsx';
import FarmReports from './ui/pages/FarmReports.tsx';
import Departments from './ui/pages/Departments.tsx';
import Preview from './ui/pages/Preview.tsx';
import { hasUserGameToday } from './core/sim/day.ts';

const SIDEBAR: { head: string; links: [string, string][] }[] = [
  { head: 'League', links: [['dashboard', 'Dashboard'], ['inbox', 'Inbox'], ['preview', 'Season Preview'], ['standings', 'Standings'], ['playoffs', 'Playoffs'], ['scores', 'Scores'], ['transactions', 'Transactions'], ['moves', 'Transaction Review'], ['news', 'News'], ['storylines', 'Storylines'], ['awards', 'Awards'], ['history', 'History & Records'], ['league-payrolls', 'League Payrolls']] },
  { head: 'Team', links: [['roster', 'Roster'], ['roster-moves', 'Roster Moves'], ['playoff-roster', 'Playoff Roster'], ['depth', 'Depth Chart'], ['farm', 'Farm System'], ['farm-reports', 'Farm Reports'], ['schedule', 'Schedule'], ['payroll', 'Payroll & CBT'], ['finances', 'Finances'], ['departments', 'Departments'], ['staff', 'Staff'], ['injuries', 'Injuries']] },
  { head: 'Trades', links: [['trade', 'Trade'], ['trade-finder', 'Trade Finder'], ['compare', 'Compare Players'], ['trade-market', 'Trade Market'], ['trading-block', 'Trading Block'], ['trade-offers', 'Trade Offers']] },
  { head: 'Players', links: [['stats', 'Stats'], ['prospects', 'Top Prospects'], ['free-agents', 'Free Agents'], ['waivers', 'Waivers']] },
  { head: 'Front Office', links: [['offseason', 'Offseason'], ['draft', 'Draft'], ['international', 'International'], ['rule5', 'Rule 5'], ['tenders', 'Tenders & Arb'], ['extensions', 'Extensions']] },
  { head: 'Tools', links: [['settings', 'League Settings'], ['', 'Switch League']] },
];

// Page names in stop messages become links, with a button to jump straight there.
const MESSAGE_PAGES: [string, string][] = [
  ['Inbox page', 'inbox'], ['Draft page', 'draft'], ['Playoff Roster page', 'playoff-roster'], ['Offseason page', 'offseason'],
  ['International page', 'international'], ['Tenders & Arbitration page', 'tenders'], ['Trading Block page', 'trading-block'],
  ['Staff page', 'staff'], ['Rule 5 page', 'rule5'], ['Trade Offers page', 'trade-offers'], ['Free Agents page', 'free-agents'],
];
function MessageText({ text }: { text: string }) {
  const hit = MESSAGE_PAGES.find(([name]) => text.includes(name));
  if (!hit) return <>{text}</>;
  const [name, page] = hit;
  const i = text.indexOf(name);
  return (
    <>
      {text.slice(0, i)}<a href={href(page)}>{name}</a>{text.slice(i + name.length)}{' '}
      <button className="btn btn-sm btn-primary" onClick={() => go(page)}>Go there</button>
    </>
  );
}

function PlayMenu({ league, simming, inLive }: { league: League; simming: boolean; inLive: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  if (simming) {
    return (
      <button className="btn btn-play" onClick={() => requestStop()}>
        Stop
      </button>
    );
  }
  const items: { label: string; run?: () => void; disabled?: boolean }[] = [];
  const playLive = { label: "Play today's game live", run: () => { if (startLive()) go('live'); } };
  if (inLive) {
    items.push({ label: 'Return to the live game', run: () => go('live') });
  } else if (league.phase === 'regular') {
    if (hasUserGameToday(league)) items.push(playLive);
    const draftLive = league.day === league.settings.draftDay && (!league.draft || league.draft.season !== league.season || !league.draft.done);
    if (draftLive) {
      items.push({ label: 'Go to the draft', run: () => go('draft') });
      if (league.draft?.season === league.season) items.push({ label: 'Auto-draft the rest (scouting director picks)', run: () => { while (league.draft && !league.draft.done) advanceDraft(league, true); setMessage(null); changed(); } });
    }
    items.push({ label: 'One day', run: () => sim(1, 'Playing') });
    items.push({ label: 'One week', run: () => sim(7, 'Playing') });
    items.push({ label: 'One month', run: () => sim(30, 'Playing') });
    const s = league.settings;
    if (league.day < s.draftDay) items.push({ label: 'Until All-Star break (draft)', run: () => sim((l) => l.day >= l.settings.draftDay, 'Playing') });
    if (league.day <= s.tradeDeadlineDay) items.push({ label: 'Until trade deadline (Jul 31)', run: () => sim((l) => l.day >= l.settings.tradeDeadlineDay || l.phase !== 'regular', 'Playing') });
    if (league.day <= s.postseasonEligibilityDay) items.push({ label: 'Until Aug 31 (postseason rosters)', run: () => sim((l) => l.day >= l.settings.postseasonEligibilityDay || l.phase !== 'regular', 'Playing') });
    if (league.day < s.septemberDay) items.push({ label: 'Until September call-ups', run: () => sim((l) => l.day >= l.settings.septemberDay, 'Playing') });
    items.push({ label: 'Until end of regular season', run: () => sim((l) => l.phase !== 'regular', 'Playing') });
  } else if (league.phase === 'playoffs') {
    if (hasUserGameToday(league)) items.push(playLive);
    items.push({ label: 'One day', run: () => sim(1, 'Playoffs') });
    items.push({ label: 'Until end of playoffs', run: () => sim((l) => l.phase !== 'playoffs', 'Playoffs') });
  } else {
    const ev = nextEvent(league);
    items.push({ label: 'One day', run: () => sim(1, 'Offseason') });
    items.push({ label: 'One week', run: () => sim(7, 'Offseason') });
    if (ev) {
      const n = league.events.length;
      items.push({ label: `Until ${ev.label.toLowerCase()}`, run: () => sim((l) => l.events.length > n || l.phase !== 'offseason', 'Offseason') });
    }
    items.push({ label: 'Until Opening Day', run: () => sim((l) => l.phase === 'regular', 'Offseason') });
  }
  return (
    <div className="dropdown" ref={ref}>
      <button className="btn btn-play" onClick={() => setOpen(!open)}>
        Play ▾
      </button>
      {open && (
        <div className="menu">
          {items.map((it) => (
            <button
              key={it.label}
              disabled={it.disabled}
              onClick={() => {
                setOpen(false);
                it.run?.();
              }}
            >
              {it.label}
            </button>
          ))}
          <div className="menu-hint">Keys: D day · W week · M month · / find a player</div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const st = useStore();
  const route = useRoute();
  const league = st.league;
  // Phones: the sidebar slides in from a menu button and closes on navigation.
  const [navOpen, setNavOpen] = useState(false);
  const routeKey = `${route.page}/${route.args.join('/')}`;
  useEffect(() => setNavOpen(false), [routeKey]);
  // Browser tab title follows the page (player pages show his name).
  useEffect(() => {
    const p = route.page === 'player' && league ? league.players[Number(route.args[0])] : undefined;
    const label = p ? `${p.first} ${p.last}` : SIDEBAR.flatMap((g) => g.links).find(([pg]) => pg === route.page)?.[1] ?? (route.page === 'live' ? 'Live game' : '');
    document.title = label ? `${label} · Baseball GM` : 'Baseball GM';
  }, [routeKey, league]);
  // Keyboard shortcuts: D = one day, W = one week, M = one month (/ = player search).
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable) return;
      const l = st.league;
      if (!l || st.simming || st.live || st.confirm) return;
      const days = { d: 1, w: 7, m: 30 }[e.key.toLowerCase()];
      if (!days || (l.phase === 'playoffs' && days > 1)) return;
      e.preventDefault();
      void sim(days, l.phase === 'regular' ? 'Playing' : l.phase === 'playoffs' ? 'Playoffs' : 'Offseason');
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [st.league, st.simming, st.live, st.confirm]);

  const dialog = st.confirm && (
    <div className="modal-back">
      <div className="modal">
        <p>{st.confirm.text}</p>
        <div className="form-row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={() => st.confirm!.resolve(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={() => st.confirm!.resolve(true)}>OK</button>
        </div>
      </div>
    </div>
  );
  const wrap = (x: ReactNode) => (
    <>
      {x}
      {dialog}
    </>
  );

  if (!league || route.page === '') return wrap(<Home />);

  const org = league.orgs[league.userOrgId];
  const phaseLabel = league.phase === 'regular' ? 'regular season' : league.phase === 'playoffs' ? 'playoffs' : league.phase === 'preseason' ? 'spring training' : 'offseason';
  let page;
  switch (route.page) {
    case 'dashboard': page = <Dashboard />; break;
    case 'roster': page = <Roster />; break;
    case 'player': page = <PlayerPage />; break;
    case 'standings': page = <Standings />; break;
    case 'stats': page = <Stats />; break;
    case 'transactions': page = <Transactions />; break;
    case 'depth': page = <Depth />; break;
    case 'roster-moves': page = <RosterBoard />; break;
    case 'extensions': page = <Extensions />; break;
    case 'negotiate': page = <Negotiate />; break;
    case 'inbox': page = <Inbox />; break;
    case 'storylines': page = <Storylines />; break;
    case 'awards': page = <Awards />; break;
    case 'history': page = <History />; break;
    case 'finances': page = <Finances />; break;
    case 'trade-finder': page = <TradeFinder />; break;
    case 'playoff-roster': page = <PlayoffRoster />; break;
    case 'compare': page = <Compare />; break;
    case 'farm': page = <Farm />; break;
    case 'staff': page = <Staff />; break;
    case 'schedule': page = <Schedule />; break;
    case 'scores': page = <Scores />; break;
    case 'box': page = <Box />; break;
    case 'payroll': page = <Payroll />; break;
    case 'league-payrolls': page = <LeaguePayrolls />; break;
    case 'free-agents': page = <FreeAgents />; break;
    case 'waivers': page = <Waivers />; break;
    case 'injuries': page = <Injuries />; break;
    case 'playoffs': page = <Playoffs />; break;
    case 'settings': page = <SettingsPage />; break;
    case 'news': page = <News />; break;
    case 'prospects': page = <Prospects />; break;
    case 'offseason': page = <Offseason />; break;
    case 'tenders': page = <Tenders />; break;
    case 'rule5': page = <Rule5 />; break;
    case 'international': page = <International />; break;
    case 'draft': page = <Draft />; break;
    case 'trade': page = <Trade />; break;
    case 'trading-block': page = <TradingBlock />; break;
    case 'trade-offers': page = <TradeOffers />; break;
    case 'trade-market': page = <TradeMarket />; break;
    case 'moves': page = <Moves />; break;
    case 'move': page = <MoveDetail />; break;
    case 'live': page = <Live />; break;
    case 'farm-reports': page = <FarmReports />; break;
    case 'departments': page = <Departments />; break;
    case 'preview': page = <Preview />; break;
    default: page = <Dashboard />;
  }

  return wrap(
    <>
      <div className="topbar">
        <button className="nav-toggle" aria-label="Menu" onClick={() => setNavOpen((x) => !x)}>☰</button>
        <a className="brand" href={href('dashboard')}>
          Baseball GM
        </a>
        <PlayMenu league={league} simming={st.simming} inLive={!!st.live} />
        <div className="status">
          <b>{dayLabel(league.season, league.day)}</b>
          <span className="full">
            <br />
            {league.season} {phaseLabel} · {org.region} {org.name}
          </span>
        </div>
        {st.simming && <span className="progress">{st.progress}</span>}
        <span className="spacer" />
        <TopSearch league={league} />
        <span className="toplinks">
          <a href={href('roster')}>Roster</a>
          <a href={href('farm')}>Farm</a>
          <a href={href('stats')}>Stats</a>
        </span>
      </div>
      <div className="layout">
        {navOpen && <div className="nav-back" onClick={() => setNavOpen(false)} />}
        <nav className={`sidebar${navOpen ? ' open' : ''}`}>
          {SIDEBAR.map((g) => (
            <div key={g.head}>
              <div className="head">{g.head}</div>
              {g.links.map(([page, label]) => (
                <a key={label} href={href(page)} className={route.page === page ? 'active' : ''}>
                  {label}
                  {page === 'trade-offers' && league.tradeOffers.length > 0 && <span className="tag">{league.tradeOffers.length}</span>}
                  {page === 'inbox' && unreadInbox(league) > 0 && <span className="tag">{unreadInbox(league)}</span>}
                </a>
              ))}
            </div>
          ))}
        </nav>
        <main className="content">
          {st.message && (
            <div className="alert alert-warn">
              <MessageText text={st.message} />{' '}
              <button className="btn btn-sm" onClick={() => setMessage(null)}>
                Dismiss
              </button>
            </div>
          )}
          {page}
        </main>
      </div>
    </>
  );
}
