import { createLeague } from '../src/core/league.ts';
import { simOneDay } from '../src/core/sim/day.ts';
import { advanceDraft } from '../src/core/draft.ts';
import { aiCounterFor, balanceForAi, emptyAssets, evaluate, validateTrade } from '../src/core/trade.ts';
import { projectValue } from '../src/core/value.ts';
import { ovr, potOvr } from '../src/core/ratings.ts';
import { orgPlayers } from '../src/core/util.ts';
const L = createLeague({ name: 't', userOrgIndex: 28, season: 2027 });
const U = L.orgs[28];
console.log('strategies', L.orgs.map(o => o.abbrev + ':' + o.strategy[0] + '/' + o.owner.type[0] + '$' + (o.budget / 1e6).toFixed(0)).join(' '));
// value sanity
const mine = orgPlayers(L, 28).map(p => ({ p, v: projectValue(L, U, p).total })).sort((a, b) => b.v - a.v);
for (const { p, v } of mine.slice(0, 6)) console.log('top value', p.first, p.last, p.pos, p.level, 'age', L.season - p.born, 'ovr', ovr(p).toFixed(0), 'pot', potOvr(p).toFixed(0), 'sal', (p.contract.salary / 1e6).toFixed(1), 'exp', p.contract.exp, 'value $', (v / 1e6).toFixed(1) + 'M');
for (const { p, v } of mine.slice(-3)) console.log('worst value', p.first, p.last, p.pos, p.level, 'age', L.season - p.born, 'ovr', ovr(p).toFixed(0), 'sal', (p.contract.salary / 1e6).toFixed(1), 'exp', p.contract.exp, 'value $', (v / 1e6).toFixed(1) + 'M');
// AI counter for user's best player
const ai = L.orgs[0];
const star = mine[0].p;
const c = aiCounterFor(L, ai, { ...emptyAssets(), pids: [star.id] });
console.log('counter for', star.last, c ? c.give[0].pids.map(id => { const p = L.players[id]; return `${p.last} ${p.pos} ${p.level} ovr${ovr(p).toFixed(0)} pot${potOvr(p).toFixed(0)}`; }).join(' | ') : null);
if (c) { console.log('AI eval', evaluate(L, ai, c), 'user eval', evaluate(L, U, c)); }
// ask for AI star with nothing -> balance
const aiStar = orgPlayers(L, 0).map(p => ({ p, v: projectValue(L, ai, p).total })).sort((a, b) => b.v - a.v)[0].p;
const ask = { orgs: [28, 0] as [number, number], give: [emptyAssets(), { ...emptyAssets(), pids: [aiStar.id] }] as [any, any] };
const bal = balanceForAi(L, ask);
console.log('ask for', aiStar.last, '-> AI wants', bal ? bal.give[0].pids.map(id => L.players[id].last + '(' + ovr(L.players[id]).toFixed(0) + '/' + potOvr(L.players[id]).toFixed(0) + ' ' + L.players[id].level + ')').join(', ') : 'no deal', bal ? validateTrade(L, bal) : '');
let n = 0;
const t0 = Date.now();
while (L.phase !== 'offseason' && n++ < 400) { const r = simOneDay(L); if (r.stop?.includes('clock')) advanceDraft(L, true); else if (r.stop) { console.log('stop', r.stop); break; } }
const trades = L.transactions.filter(t => t.type === 'Trade');
console.log('season time', ((Date.now() - t0) / 1000).toFixed(1), 'trades (x2 per trade)', trades.length, 'offers to user', L.news.filter(n => n.text.includes('trade offer')).length);
console.log(trades.filter((_, i) => i % 2 === 0).slice(0, 8).map(t => `${L.orgs[t.orgId!].abbrev} d${t.day}: ${t.text}`).join('\n'));
const byDay = trades.filter((_, i) => i % 2 === 0).map(t => t.day); console.log('trades before day 100:', byDay.filter(d => d < 100).length, 'day 100-127:', byDay.filter(d => d >= 100 && d <= 127).length, 'after deadline:', byDay.filter(d => d > 127).length);
