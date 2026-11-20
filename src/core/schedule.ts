// Season schedule generation for every level.
import type { Game, Level, Org, Settings } from './types.ts';
import { LEVELS } from './types.ts';
import { rand, shuffle } from './random.ts';

const SERIES_LEN: Record<Level, number> = { MLB: 3, AAA: 6, AA: 6, 'A+': 6, A: 6, CPX: 6, DSL: 6 };

function seriesTargets(orgs: Org[], level: Level, nSeries: number): number[][] {
  const n = orgs.length;
  const t: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      if (level === 'MLB') {
        const a = orgs[i];
        const b = orgs[j];
        if (a.league === b.league && a.div === b.div) t[i][j] = 13 / 3;
        else if (a.league === b.league) t[i][j] = 6.4 / 3;
        else t[i][j] = 46 / 15 / 3;
      } else {
        t[i][j] = nSeries / (n - 1);
      }
    }
  }
  return t;
}

function matchRound(n: number, target: number[][], played: number[][]): [number, number][] {
  for (let attempt = 0; attempt < 20; attempt++) {
    const order = shuffle([...Array(n).keys()]);
    const used = new Array(n).fill(false);
    const pairs: [number, number][] = [];
    let ok = true;
    for (const a of order) {
      if (used[a]) continue;
      const cands: number[] = [];
      const weights: number[] = [];
      for (let b = 0; b < n; b++) {
        if (b === a || used[b]) continue;
        const need = target[a][b] - played[a][b];
        cands.push(b);
        weights.push(Math.max(0.01, need + 0.15) ** 3);
      }
      if (cands.length === 0) {
        ok = false;
        break;
      }
      let total = 0;
      for (const w of weights) total += w;
      let r = rand() * total;
      let pick = cands[cands.length - 1];
      for (let k = 0; k < cands.length; k++) {
        r -= weights[k];
        if (r <= 0) {
          pick = cands[k];
          break;
        }
      }
      used[a] = used[pick] = true;
      pairs.push([a, pick]);
    }
    if (ok) return pairs;
  }
  throw new Error('Could not build schedule round');
}

export function buildSchedule(orgs: Org[], settings: Settings, startGameId: number): Game[] {
  const games: Game[] = [];
  let gid = startGameId;
  for (const level of LEVELS) {
    const n = orgs.length;
    const G = settings.gamesPerSeason[level];
    const len = SERIES_LEN[level];
    const nSeries = Math.ceil(G / len);
    const target = seriesTargets(orgs, level, nSeries);
    const played = Array.from({ length: n }, () => new Array(n).fill(0));
    const hosted = Array.from({ length: n }, () => new Array(n).fill(0));
    const homeCount = new Array(n).fill(0);

    // Off days: minors play 6-game series with one off day between them; MLB
    // spreads its remaining off days randomly between series.
    const gaps: number[] = new Array(nSeries).fill(0);
    if (level === 'MLB') {
      const offDays = Math.max(0, settings.seasonDays - G);
      const idx = shuffle([...Array(nSeries - 1).keys()]).slice(0, offDays);
      for (const i of idx) gaps[i] = 1;
    } else {
      for (let i = 0; i < nSeries - 1; i++) gaps[i] = 1;
    }

    let day = settings.levelStartDay[level];
    let gamesLeft = G;
    for (let s = 0; s < nSeries; s++) {
      const thisLen = Math.min(len, gamesLeft);
      const pairs = matchRound(n, target, played);
      for (const [a, b] of pairs) {
        played[a][b]++;
        played[b][a]++;
        let home: number;
        if (hosted[a][b] !== hosted[b][a]) home = hosted[a][b] < hosted[b][a] ? a : b;
        else if (homeCount[a] !== homeCount[b]) home = homeCount[a] < homeCount[b] ? a : b;
        else home = rand() < 0.5 ? a : b;
        const away = home === a ? b : a;
        hosted[home][away]++;
        homeCount[home] += thisLen;
        for (let g = 0; g < thisLen; g++) {
          games.push({ id: gid++, level, day: day + g, home: orgs[home].id, away: orgs[away].id, result: null });
        }
      }
      day += thisLen + gaps[s];
      gamesLeft -= thisLen;
    }
  }
  games.sort((x, y) => x.day - y.day || x.id - y.id);
  return games;
}
