import { createLeague } from '../src/core/league.ts';
import { simOneDay, userRosterIssues } from '../src/core/sim/day.ts';
import * as R from '../src/core/rules.ts';
import { activeAt, fortyMan, orgPlayers } from '../src/core/util.ts';
import { ovr, isPitcher } from '../src/core/ratings.ts';
const L = createLeague({ name: 't', userOrgIndex: 28, season: 2027 });
const U = L.userOrgId;
const log = (...a: unknown[]) => console.log(...a);
for (let i = 0; i < 20; i++) simOneDay(L);
const mlb = activeAt(L, U, 'MLB');
const rp = mlb.filter(p => p.pos === 'RP').sort((a,b)=>ovr(a)-ovr(b));
const target = rp.find(p => !R.canOption(L, p))!;
log('option check', target.last, R.canOption(L, target));
R.optionPlayer(L, target, 'AAA');
log('after option active', activeAt(L, U, 'MLB').length, 'recall immediately ->', R.canRecall(L, target));
// select contract of best non-40 AAA pitcher
const cand = activeAt(L, U, 'AAA').filter(p => !p.on40 && isPitcher(p)).sort((a,b)=>ovr(b)-ovr(a))[0];
log('select check', cand.last, R.canSelect(L, cand), '40-man', fortyMan(L, U).length);
// DFA a 40-man minor leaguer to make room
const dfa = fortyMan(L, U).filter(p => p.level !== 'MLB').sort((a,b)=>ovr(a)-ovr(b))[0];
R.designate(L, dfa); log('dfa', dfa.last, '40-man now', fortyMan(L, U).length, 'select check', R.canSelect(L, cand));
R.selectContract(L, cand); log('selected; active', activeAt(L, U, 'MLB').length, '40', fortyMan(L, U).length);
// a veteran with 5+ years can't be optioned
const vet = mlb.find(p => p.mlServiceDays >= 5*172 && p.on40 && p.level==='MLB');
if (vet) log('vet option check', vet.last, R.canOption(L, vet));
// min stay
for (let i = 0; i < 5; i++) simOneDay(L);
log('recall after 5 days', R.canRecall(L, target));
for (let i = 0; i < 12; i++) simOneDay(L);
log('recall after 17 days', R.canRecall(L, target), 'option days', target.optionDaysThisSeason, 'options used', target.optionsUsed);
log('dfa player status', dfa.orgId, dfa.level, dfa.on40, dfa.waivers, dfa.dfa, 'outrighted', dfa.outrightedBefore);
// manual mode issues
L.settings.autoMlbMoves = false;
const inj = activeAt(L, U, 'MLB')[0]; inj.injury = { name: 'test', daysLeft: 20, totalDays: 20 };
log('issues', userRosterIssues(L));
log('sim stops?', simOneDay(L).stop?.slice(0, 80));
log('IL check', R.canPlaceIL(L, inj)); R.placeIL(L, inj); log('il', inj.il);
log('issues after IL', userRosterIssues(L));
const up = fortyMan(L, U).filter(p=>p.level==='AAA' && !p.il && !p.injury && isPitcher(p) === isPitcher(inj))[0];
log('recall replacement (exempt)', R.canRecall(L, up, true)); R.recallPlayer(L, up);
log('issues after recall', userRosterIssues(L), 'sim', simOneDay(L).stop);
const types: Record<string, number> = {}; for (const t of L.transactions.filter(t=>t.orgId===U)) types[t.type]=(types[t.type]??0)+1; log('user tx', types);
log('user org size', orgPlayers(L, U).length);
log(L.transactions.filter(t=>t.orgId===U).slice(-6).map(t=>t.text));
log(L.news.slice(-5).map(n=>n.text));
