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

## Next milestones

1. Trades, with AI built on surplus value, plus trade offers in the assistant GM's duties.
2. Contract extensions, rehab assignments, scouting director, full finances.
