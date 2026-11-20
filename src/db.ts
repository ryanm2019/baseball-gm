// Leagues are saved in the browser (IndexedDB), like Basketball GM.
import { openDB, type IDBPDatabase } from 'idb';
import type { League } from './core/types.ts';

export interface LeagueMeta {
  id: string;
  name: string;
  season: number;
  day: number;
  phase: string;
  team: string;
  updated: number;
}

let dbp: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  dbp ??= openDB('baseball-gm', 1, {
    upgrade(d) {
      d.createObjectStore('meta', { keyPath: 'id' });
      d.createObjectStore('leagues');
    },
  });
  return dbp;
}

export async function listLeagues(): Promise<LeagueMeta[]> {
  const all = (await (await db()).getAll('meta')) as LeagueMeta[];
  return all.sort((a, b) => b.updated - a.updated);
}

export async function saveLeague(league: League): Promise<void> {
  const d = await db();
  const org = league.orgs[league.userOrgId];
  const meta: LeagueMeta = {
    id: league.id,
    name: league.name,
    season: league.season,
    day: league.day,
    phase: league.phase,
    team: `${org.region} ${org.name}`,
    updated: Date.now(),
  };
  const tx = d.transaction(['meta', 'leagues'], 'readwrite');
  await Promise.all([tx.objectStore('meta').put(meta), tx.objectStore('leagues').put(league, league.id), tx.done]);
}

export async function loadLeague(id: string): Promise<League | undefined> {
  return (await (await db()).get('leagues', id)) as League | undefined;
}

export async function deleteLeague(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(['meta', 'leagues'], 'readwrite');
  await Promise.all([tx.objectStore('meta').delete(id), tx.objectStore('leagues').delete(id), tx.done]);
}
