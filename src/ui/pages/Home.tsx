import { useEffect, useState } from 'react';
import { createLeague } from '../../core/league.ts';
import { ORG_DEFS } from '../../core/teams.ts';
import { deleteLeague, listLeagues, loadLeague, saveLeague, type LeagueMeta } from '../../db.ts';
import { setLeague } from '../../store.ts';
import { askConfirm } from '../../store.ts';
import { go, useRoute } from '../../router.ts';
import { dayShort } from '../../core/settings.ts';
import type { League } from '../../core/types.ts';

function remember(id: string) {
  try {
    localStorage.setItem('bgm-last', id);
  } catch {
    /* storage unavailable */
  }
}

function lastId(): string | null {
  try {
    return localStorage.getItem('bgm-last');
  } catch {
    return null;
  }
}

export default function Home() {
  const route = useRoute();
  const [leagues, setLeagues] = useState<LeagueMeta[] | null>(null);
  const [name, setName] = useState('My League');
  const [team, setTeam] = useState(ORG_DEFS.findIndex((d) => d.abbrev === 'ARI'));
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  const open = async (id: string, page = 'dashboard') => {
    setBusy('Loading league…');
    const l = await loadLeague(id);
    setBusy('');
    if (!l) {
      setErr('Could not load that league.');
      return;
    }
    remember(id);
    setLeague(l);
    if (page) go(page);
  };

  useEffect(() => {
    listLeagues()
      .then((ls) => {
        setLeagues(ls);
        // Reloading on a league page: reopen the last league.
        const last = lastId();
        if (route.page !== '' && last && ls.some((l) => l.id === last)) void open(last, '');
      })
      .catch((e) => {
        setLeagues([]);
        setErr(`Browser storage is unavailable here (${(e as Error).message}). Leagues can still be played but will not be saved.`);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async () => {
    setBusy('Creating league: generating 6,000+ players…');
    await new Promise((r) => setTimeout(r, 30));
    const l = createLeague({ name: name.trim() || 'My League', userOrgIndex: team, season: 2027 });
    try {
      await saveLeague(l);
      remember(l.id);
    } catch {
      /* not saved; still playable */
    }
    setBusy('');
    setLeague(l);
    go('dashboard');
  };

  const importFile = async (file: File) => {
    try {
      setBusy('Importing…');
      const l = JSON.parse(await file.text()) as League;
      if (!l.orgs || !l.players || !l.settings) throw new Error('Not a Baseball GM league file');
      await saveLeague(l);
      remember(l.id);
      setBusy('');
      setLeague(l);
      go('dashboard');
    } catch (e) {
      setBusy('');
      setErr(`Import failed: ${(e as Error).message}`);
    }
  };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '20px' }}>
      <h1>Baseball GM</h1>
      <p className="muted">
        Run a baseball organization from MLB down to the Dominican Summer League. Everything is saved in this browser.
      </p>
      {err && <div className="alert alert-err">{err}</div>}
      {busy && <div className="alert alert-info">{busy}</div>}

      <h2>Your leagues</h2>
      {leagues === null ? (
        <p className="muted">Loading…</p>
      ) : leagues.length === 0 ? (
        <p className="muted">No leagues yet.</p>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th className="l">League</th>
              <th className="l">Team</th>
              <th>Season</th>
              <th className="l">Date</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {leagues.map((l) => (
              <tr key={l.id}>
                <td className="l">
                  <a href="#/" onClick={(e) => { e.preventDefault(); void open(l.id); }}>
                    {l.name}
                  </a>
                </td>
                <td className="l">{l.team}</td>
                <td>{l.season}</td>
                <td className="l">{l.phase === 'regular' ? dayShort(l.season, l.day) : l.phase}</td>
                <td>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={async () => {
                      if (!(await askConfirm(`Delete ${l.name}? This cannot be undone.`))) return;
                      await deleteLeague(l.id);
                      setLeagues(await listLeagues());
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>New league</h2>
      <div className="form-row">
        <label>
          Name <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Team{' '}
          <select value={team} onChange={(e) => setTeam(Number(e.target.value))}>
            {ORG_DEFS.map((d, i) => ({ d, i }))
              .sort((a, b) => a.d.region.localeCompare(b.d.region))
              .map(({ d, i }) => (
                <option key={d.abbrev} value={i}>
                  {d.region} {d.name} ({d.league} {d.div})
                </option>
              ))}
          </select>
        </label>
        <button className="btn btn-primary" disabled={!!busy} onClick={() => void create()}>
          Create league
        </button>
      </div>
      <p className="muted small">
        Random players, 30 organizations, each with AAA, AA, High-A, Single-A, complex league and DSL affiliates. The season starts on Opening Day 2027.
      </p>

      <h2>Import league</h2>
      <input type="file" accept=".json,application/json" onChange={(e) => e.target.files?.[0] && void importFile(e.target.files[0])} />
    </div>
  );
}
