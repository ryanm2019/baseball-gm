# Baseball GM

A single-player baseball front-office sim in the spirit of Basketball GM, with the depth of OOTP's organizational rules. It runs entirely in the browser (TypeScript + React, no server), and leagues are saved in IndexedDB.

## Run it

```
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/
```

Headless checks (Node 22+):

```
node --experimental-strip-types scripts/check-season.ts   # sims a full season, prints league environment by level
node --experimental-strip-types scripts/check-rules.ts    # exercises option / DFA / waivers / IL rules
```

## What's in milestone 1 (in-season)

- **League**: 30 fictional organizations (AL/NL, 3 divisions each). Each has an MLB club plus AAA, AA, High-A, Single-A, a complex league (ACL/FCL) team, and a DSL team: about 6,400 random players.
- **Schedules**: 162 games in MLB; 150 (AAA), 138 (AA), 132 (A+/A), and about 56-60 (complex leagues and DSL, starting in June). Real playoff format: 6 teams per league, with best-of-3, 5, 7 and 7 rounds.
- **Ratings (20-80, with scouting fog)**:
  - Hitters: contact (made of BABIP and Avoid K), gap, power and eye, each split vs. LHP and vs. RHP.
  - Pitchers: stuff, movement, control, stamina, groundball tendency and a pitch arsenal.
  - Defensive components feed position ratings for every position. Players also have running ratings and a personality.
- **Game engine**: resolves each plate appearance with the odds-ratio (log5) method and simulates pitch counts. It models:
  - fatigue, times through the order, and platoon matchups
  - bullpen roles and reliever rest
  - baserunning, steals, double plays, errors and wild pitches
  - the automatic runner in extra innings, and injuries
  - a different run environment at each level
- **Roster rules** (all editable in League Settings):
  - 26-man active roster with a 13-pitcher limit; 28 and 14 from September 1. 40-man roster.
  - Options: 3 option years, charged after 20 days down in a season; at most 5 options per season; minimum stay of 15 days for pitchers and 10 for position players unless replacing an injured player; a player with 5+ years of service can't be optioned without his consent.
  - DFA (7 days), outright and release waivers (claims go in reverse order of standings), and outright assignments. A player with 3+ years of service, or who was outrighted before, can refuse an outright.
  - Injured lists: 10-day, 15-day and 60-day (60-day players are off the 40-man count), plus minor league ILs.
  - Service time: 172 days counts as a year, earned on the active roster or the MLB IL.
  - Contract selections, adding a player to the 40-man, minor league roster limits, and in-season free agents.
- **Farm director**: hire or fire him (development, evaluation, philosophy). He runs every affiliate you leave under his control: injuries, filling holes, and promotions and demotions based on his scouted read and the player's performance. You can take any level over yourself.
- **Payroll and CBT**:
  - One-way vs. split contracts and dead money.
  - CBT payroll projection with first, second and third-time payer base rates and tier surcharges.

## Milestone 2: staff, offseason, draft

- **Staff**: assistant GM, manager, pitching coach, hitting coach and farm director, each with ratings, a salary and a contract. Hire, fire and extend them; AI clubs replace theirs.
  - Manager style and tactics change starter hooks, bullpen choices and steals.
  - Coaches speed up MLB player development, and the pitching coach's health rating lowers MLB pitcher injuries.
  - **Assistant GM duties** are switchable one by one: injuries, roster moves, depth chart, options and qualifying offers, tenders, arbitration, Rule 5 protection and picks, minor league free agents, the draft, and international signings. Anything you keep, the sim stops for.
- **Offseason calendar**: options and qualifying offers, free agency, qualifying-offer responses, Rule 5 protection (Nov 18), non-tenders (Nov 22), the Rule 5 draft (Dec 10), the international class (Dec 15), arbitration exchange (Jan 9) and hearings (Feb 5), the international signing period (Jan 15), then spring training and Opening Day.
- **Free agency with competing offers**: players ask for years and dollars. AI clubs bid based on need and budget, and you can bid too. Each player decides on his own timeline, weighing money, years, how good the team is and loyalty. A player who declined a qualifying offer costs his new team a second-round pick and gives his old team a compensation pick.
- **Arbitration**: Super Two (top 22% of the 2-year class), projected salaries (no more than a 20% cut), filed figures, settlements and hearings.
- **Rule 5**: eligibility after 4 or 5 pro seasons depending on signing age; picks must stay on the MLB roster or be offered back.
- **July amateur draft**: lottery for the top 6 picks, 20 rounds, slot values and bonus pools (up to 5% over is allowed), and a signing deadline.
- **International amateurs**: bonus pools by market size, a class of 16-17 year olds and AI signings.
- **Winter**: aging, development, potential that drifts (breakouts and busts), retirements, the 4th option year, luxury tax payer streaks, and rating re-centering so 50 stays MLB average.

## Milestone 3: owners, MLB penalties, trades

- **Owners**: each club has an owner type (cheap, moderate, big spender, win-now) that changes when a team is sold. Owner type plus market size set the payroll budget. AI clubs pick a strategy (contend, retool, rebuild) each winter and again before the deadline. Strategy drives free-agent spending and how they value players.
- **Your owner**: a soft budget. Going over, missing expectations and paying tax cost job security; winning raises it. At 0 you're fired and can take another job.
- **MLB penalties**:
  - Tax rates rise with repeat-payer status, with a higher third-tier surcharge for repeat payers.
  - Clubs $40M+ over the threshold have their top first-round pick moved back 10 spots.
  - Signing a free agent who declined a qualifying offer costs, by the signing club's status: tax payors lose their 2nd and 5th-round picks plus $1M of international pool money; revenue-sharing recipients lose their 3rd-round pick; everyone else loses their 2nd-round pick plus $500k. Compensation picks for the club that lost the player come after round 1, after Competitive Balance B, or after round 4, depending on its status.
- **Competitive Balance Rounds A and B** for the smallest markets. These are the only tradable picks.
- **Trades**: players, cash and international pool money ($250k increments; a club can add up to 60% of its pool), plus CB picks.
  - Rules: trade deadline Jul 31; no trades in the playoffs; offseason free agents can't be traded until June 15; draftees can't be traded until after the World Series.
  - Cash is limited to the remaining salary sent plus $1M, and both clubs need 40-man room. 10-and-5 players can veto. Players acquired after Aug 31 can't play in the postseason.
- **Trade AI**: values players by surplus value: projected WAR over the years of control (contract, arbitration, pre-arb) at $8M/WAR, minus salary, discounted. That gets adjusted for strategy (contenders weight this year, rebuilders the future), prospect risk by level, position need, and budget. Small pieces are discounted, so you can't win a deal with a pile of filler.
- Includes "What would make this work?", a trading block, a difficulty setting (Easy to Insane), AI-to-AI trades with an adjustable frequency (busiest before the deadline), and AI offers to you that the assistant GM can answer.
- **More "sim to" options**: All-Star break / draft, trade deadline, Aug 31, September, end of regular season, playoffs, and each offseason event.

## Milestone 4: trade market, owner goals, scouts, transaction review

- **Trade calendar**: AI-to-AI trades come in flurries in the three weeks before the Jul 31 deadline (peaking on deadline day) and through the winter, busiest at the Winter Meetings (Dec 7-10, now on the offseason calendar). Early season is quiet.
- **Trade market**: every club signals a direction (contending, retooling, rebuilding) and a stance (buying, selling, listening, standing pat), lists what it's looking for, and keeps a trading block. AI trades come from these blocks and needs. The Trade Market page shows all of it.
- **Your trading block and interests**: set your stance, shop players, flag positions you want and watch specific players. AI clubs reach out with offers built around them, more often during flurries. Offers can be opened in the trade screen as a counter.
- **Owner goals**: each spring the owner sets goals by owner type and roster strength (win total, playoffs, a playoff series, payroll budget or tax line). He checks in two times a season (late May and two weeks before the deadline), and the season-end review is scored on the goals. Firing can be turned off in League Settings.
- **Scouting staff**: scouting director plus pro, amateur and international scouts, hired at different skill levels and salaries. They set how accurate the ratings you see are in each area. AI clubs' scouts shape their own draft boards, international signings and trade evaluations.
- **WAR**: FanGraphs-style WAR for MLB stats (wOBA batting runs, baserunning, fielding from ratings, positional adjustment; FIP-based pitching), shown on player pages.
- **Transaction Review**: every trade, free agent signing, waiver claim, Rule 5 pick, draft signing and international signing, with WAR acquired vs. WAR given up, salary paid and $/WAR, by team, type and season. Each move has a season-by-season breakdown.

## Live games and bullpen roles

- **Play today's game live** (Play menu) on any day your big league club plays, regular season or playoffs. The rest of the league sims; your game goes one batter at a time with a line score, bases and outs, the batter/pitcher matchup and play-by-play. Auto-play, end of half-inning, or sim to the end with your manager taking over.
- **Managing**: warm up relievers (about three hitters to get loose; cold relievers struggle at first, and warming up counts as work), bring them in (three-batter minimum), mound visits (five per game; a second in one inning removes the pitcher), intentional walks, pinch hitters and runners, defensive subs and position switches, steal, sacrifice bunt, hit-and-run, infield in. Turn off "Manager makes pitching changes" to make every pitching move yourself. No double switch: with the universal DH, pitchers never bat.
- **Bullpen roles** on the Depth Chart: closer, two setup men, middle relief, long relief and mop-up. The manager uses them by inning and score.
- Simulated games run through the same engine, so live and simmed games play the same.

## Departments, stars, farm reports, season preview

- **Departments**: scouting, player development, medical/training and facilities, funded from an operating budget the owner sets apart from payroll. Twice the normal spend gets the full benefit; half or less hurts. Facilities build or decay slowly over seasons. Overspending the operating budget costs job security.
- **Talent**: a fatter top end, so each league has a handful of 70-80 stars and a couple of 60+ players per team. Relievers' displayed overall is scaled to their value. Most draft classes have one or two generational prospects.
- **Farm Reports**: weekly notes from the farm director (players of the week, top prospects, who's struggling, who's ready to move up, and rating changes since Opening Day).
- **Promotions**: no age limits, but the younger a player is for a level, the better he has to be and the longer he has to do it before moving up.
- **Season Preview**: projected wins, rising and falling teams, top players and prospects, rising and declining players over the past year, last summer's first round one year later, and the winter's biggest signings and trades.

## Next milestones

1. Contract extensions, rehab assignments, full finances.
