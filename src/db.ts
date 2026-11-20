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
  const packed = await pack(league);
  const tx = d.transaction(['meta', 'leagues'], 'readwrite');
  await Promise.all([tx.objectStore('meta').put(meta), tx.objectStore('leagues').put(packed, league.id), tx.done]);
}

// Saves are stored as gzipped JSON (about a tenth of the size of the raw
// object). Older saves stored the object directly and still load.
async function pack(league: League): Promise<Blob | League> {
  if (typeof CompressionStream === 'undefined') return league;
  const stream = new Blob([JSON.stringify(league)]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}

export async function loadLeague(id: string): Promise<League | undefined> {
  const raw = await (await db()).get('leagues', id);
  if (raw instanceof Blob) {
    const text = await new Response(raw.stream().pipeThrough(new DecompressionStream('gzip'))).text();
    return JSON.parse(text) as League;
  }
  return raw as League | undefined;
}

export async function deleteLeague(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(['meta', 'leagues'], 'readwrite');
  await Promise.all([tx.objectStore('meta').delete(id), tx.objectStore('leagues').delete(id), tx.done]);
}
