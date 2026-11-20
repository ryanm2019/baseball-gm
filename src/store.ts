// Holds the open league in memory and notifies React when it changes.
import { useSyncExternalStore } from 'react';
import type { League } from './core/types.ts';
import { saveLeague } from './db.ts';
import { endLiveDay, simOneDay, startLiveDay, type LiveDay } from './core/sim/day.ts';
import { invalidateScheduleIndex } from './core/sim/day.ts';

interface State {
  league: League | null;
  version: number;
  simming: boolean;
  progress: string;
  message: string | null;
  confirm: { text: string; resolve: (ok: boolean) => void } | null;
  live: LiveDay | null; // the user's game being managed live
}

let state: State = { league: null, version: 0, simming: false, progress: '', message: null, confirm: null, live: null };
const listeners = new Set<() => void>();

function emit() {
  state = { ...state, version: state.version + 1 };
  for (const l of listeners) l();
}

export function useStore(): State {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

export function getLeague(): League {
  if (!state.league) throw new Error('No league loaded');
  return state.league;
}

export function setLeague(league: League | null): void {
  invalidateScheduleIndex();
  state.league = league;
  state.message = null;
  state.live = null;
  emit();
}

// Call after any change to the league to refresh views and save.
let saveTimer: ReturnType<typeof setTimeout> | null = null;
export function changed(save = true): void {
  emit();
  if (save && state.league) {
    if (saveTimer) clearTimeout(saveTimer);
    const l = state.league;
    saveTimer = setTimeout(() => void saveLeague(l), 250);
  }
}

export function setMessage(msg: string | null): void {
  state.message = msg;
  emit();
}

let stopRequested = false;
export function requestStop(): void {
  stopRequested = true;
}

// Sims until `until(league)` is true, a stop condition hits, or the user stops.
export async function sim(days: number | ((l: League) => boolean), label: string): Promise<void> {
  const league = state.league;
  if (!league || state.simming || state.live) return;
  stopRequested = false;
  state.simming = true;
  state.message = null;
  emit();
  const startDay = league.day;
  let n = 0;
  let stuck = 0;
  try {
    for (;;) {
      if (typeof days === 'number' ? n >= days : days(league)) break;
      if (stopRequested) break;
      const before = `${league.season}|${league.day}|${league.phase}|${league.events.length}`;
      const r = simOneDay(league);
      n++;
      if (!r.stop && `${league.season}|${league.day}|${league.phase}|${league.events.length}` === before) {
        stuck++;
        if (stuck >= 3) {
          state.message = 'The simulation could not advance. Check your roster and the Dashboard for problems.';
          break;
        }
      } else stuck = 0;
      if (r.stop) {
        state.message = r.stop;
        break;
      }
      if (n % 3 === 0) {
        state.progress = `${label}: day ${league.day - startDay}`;
        emit();
        await new Promise((res) => setTimeout(res, 0));
      }
    }
  } catch (e) {
    console.error(e);
    state.message = `Simulation error: ${(e as Error).message}`;
  }
  state.simming = false;
  state.progress = '';
  emit();
  await saveLeague(league);
}

// In-page confirmation (browser confirm() is blocked in some hosts).
export function askConfirm(text: string): Promise<boolean> {
  return new Promise((resolve) => {
    state.confirm = {
      text,
      resolve: (ok) => {
        state.confirm = null;
        emit();
        resolve(ok);
      },
    };
    emit();
  });
}

// ---------- live games ----------

// Plays the rest of today's schedule and opens the user's game for live managing.
export function startLive(): boolean {
  const league = state.league;
  if (!league || state.simming || state.live) return false;
  const r = startLiveDay(league);
  if ('stop' in r) {
    state.message = r.stop;
    emit();
    return false;
  }
  state.live = r;
  state.message = null;
  emit();
  return true;
}

// Re-render after a live action (no save until the game is over).
export function liveChanged(): void {
  emit();
}

// Records the finished live game and ends the day.
export async function finishLive(): Promise<void> {
  const league = state.league;
  const live = state.live;
  if (!league || !live || !live.engine.done()) return;
  const r = endLiveDay(league, live);
  state.live = null;
  state.message = r.stop;
  emit();
  await saveLeague(league);
}
