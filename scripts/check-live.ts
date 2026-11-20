// Live game: use every manager action, then make sure the game records like a normal one.
import { createLeague } from '../src/core/league.ts';
import { simOneDay, startLiveDay, endLiveDay, hasUserGameToday } from '../src/core/sim/day.ts';
const L = createLeague({ name: 't', userOrgIndex: 5, season: 2027 });
for (let i = 0; i < 3; i++) simOneDay(L);
console.log('game today', hasUserGameToday(L), 'day', L.day);
const ld = startLiveDay(L);
if ('stop' in ld) { console.log('stop', ld.stop); process.exit(1); }
const e = ld.engine;
const me = ld.userSide;
const errs: string[] = [];
const tryA = (name: string, r: string | null) => { if (r) errs.push(`${name}: ${r}`); else console.log('  ok', name); };
let did = new Set<string>();
for (let i = 0; i < 400 && !e.done(); i++) {
  const s = e.state();
  const mine = s.sides[me];
  if (s.half === me) {
    if (!did.has('ph') && s.inning >= 3) { did.add('ph'); tryA('pinch hit', e.pinchHit(me, mine.bench[0].id)); }
    if (!did.has('pr') && s.bases[0] && mine.bench.length) { did.add('pr'); tryA('pinch run', e.pinchRun(me, 0, mine.bench[0].id)); }
    if (!did.has('steal') && s.bases[0] && !s.bases[1]) { did.add('steal'); tryA('steal', e.setTactic(me, { steal: true })); }
    else if (!did.has('bunt') && (s.bases[0] || s.bases[1]) && s.outs < 2) { did.add('bunt'); tryA('bunt', e.setTactic(me, { bunt: true })); }
    else if (!did.has('hr') && s.bases[0] && !s.bases[1] && s.outs < 2) { did.add('hr'); tryA('hit-and-run', e.setTactic(me, { hitRun: true })); }
  } else {
    if (!did.has('manual') && s.inning >= 5) { did.add('manual'); e.setAutoPitching(me, false); }
    if (!did.has('warm') && s.inning >= 5) { did.add('warm'); tryA('warm up', e.warmUp(me, mine.bullpen[0].p.id)); }
    if (!did.has('visit') && s.inning >= 4) { did.add('visit'); tryA('mound visit', e.moundVisit(me)); }
    if (!did.has('ibb') && s.inning >= 4 && s.bases.every((b) => !b)) { did.add('ibb'); tryA('IBB', e.intentionalWalk(me)); }
    if (!did.has('in') && s.bases[2]) { did.add('in'); tryA('infield in', e.setTactic(me, { infieldIn: true })); }
    if (!did.has('def') && s.inning >= 7) { did.add('def'); if (mine.bench.length) tryA('defensive sub', e.defensiveSub(me, 8, mine.bench[0].id)); tryA('switch positions', e.switchPositions(me, 0, 1)); }
    const ready = mine.bullpen.find((b) => b.ready);
    if (s.inning >= 6 && ready && !did.has('bring') && mine.pitcher.line.bf >= 3) { did.add('bring'); tryA('bring in (warm)', e.bringIn(me, ready.p.id)); }
    if (mine.needPitcher || (did.has('bring') && s.inning >= 8 && !did.has('cold') && mine.pitcher.line.bf >= 3)) { did.add('cold'); tryA('bring in (cold)', e.bringIn(me, mine.bullpen[0].p.id)); }
  }
  e.step();
}
const s = e.state();
console.log('final', s.sides[0].runs, '-', s.sides[1].runs, 'innings', s.sides[0].lineScore.length, 'log lines', s.log.length, 'done', e.done());
console.log(s.log.slice(0, 6).map((x) => x.text).join('\n'));
console.log('...');
console.log(s.log.filter((x) => /pinch|Pitching change|bunt|stole|caught|intentional|Mound|replaces|moves to/.test(x.text)).map((x) => x.text).join('\n'));
console.log('errors from actions:', errs);
const day0 = L.day;
const st0 = L.standings.MLB[5].w + L.standings.MLB[5].l;
const r = endLiveDay(L, ld);
console.log('after: day', day0, '->', L.day, 'games', st0, '->', L.standings.MLB[5].w + L.standings.MLB[5].l, 'box saved', !!L.boxScores[ld.game.id], 'stop', r.stop);
// continue normally
for (let i = 0; i < 5; i++) simOneDay(L);
console.log('continued to day', L.day);
