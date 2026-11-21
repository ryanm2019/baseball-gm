// Player search in the top bar: type a name, pick a player. "/" focuses it.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { League, Player } from '../core/types.ts';
import { go } from '../router.ts';
import { posLabel } from '../core/rules.ts';
import { displayOvr, ovr } from '../core/ratings.ts';

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function where(league: League, p: Player): string {
  if (p.retired) return `Retired ${p.retired}`;
  if (p.prospect) return 'Draft prospect';
  if (p.orgId === null) return 'Free agent';
  const o = league.orgs[p.orgId];
  return p.level === 'MLB' ? o.abbrev : `${o.abbrev} ${p.level}`;
}

// Active MLB players first, then the minors, free agents, prospects, retired.
function tier(p: Player): number {
  if (p.retired) return 4;
  if (p.prospect) return 3;
  if (p.orgId === null) return 2;
  return p.level === 'MLB' ? 0 : 1;
}

export default function TopSearch({ league }: { league: League }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => input.current?.focus(), 0);
      }
    };
    const click = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', key);
    document.addEventListener('mousedown', click);
    return () => {
      document.removeEventListener('keydown', key);
      document.removeEventListener('mousedown', click);
    };
  }, []);

  const results = useMemo(() => {
    const s = fold(q.trim());
    if (s.length < 2) return [];
    const words = s.split(/\s+/);
    const out: { p: Player; score: number }[] = [];
    for (const p of Object.values(league.players)) {
      const full = fold(`${p.first} ${p.last}`);
      if (!words.every((w) => full.includes(w))) continue;
      const last = fold(p.last);
      const starts = last.startsWith(s) || full.startsWith(s) ? 0 : 1;
      out.push({ p, score: tier(p) * 1000 + starts * 200 - displayOvr(p, ovr(p)) });
    }
    return out.sort((a, b) => a.score - b.score).slice(0, 12).map((x) => x.p);
  }, [q, league]);

  const pick = (p: Player) => {
    setQ('');
    setOpen(false);
    input.current?.blur();
    go('player', [p.id]);
  };

  return (
    <div className={`top-search${open ? ' open' : ''}`} ref={box}>
      <button className="search-toggle" aria-label="Search players" onClick={() => { setOpen(true); setTimeout(() => input.current?.focus(), 0); }}>🔍</button>
      <input
        ref={input}
        placeholder="Find a player  ( / )"
        value={q}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQ(e.target.value); setSel(0); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setSel((x) => Math.min(results.length - 1, x + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((x) => Math.max(0, x - 1)); }
          else if (e.key === 'Enter' && results[sel]) pick(results[sel]);
          else if (e.key === 'Escape') { setOpen(false); input.current?.blur(); }
        }}
      />
      {open && results.length > 0 && (
        <div className="search-results">
          {results.map((p, i) => (
            <button key={p.id} className={i === sel ? 'sel' : ''} onMouseDown={(e) => { e.preventDefault(); pick(p); }}>
              <b>{p.first} {p.last}</b> <span className="muted small">{posLabel(p)} · {where(league, p)} · age {league.season - p.born}</span>
            </button>
          ))}
        </div>
      )}
      {open && q.trim().length >= 2 && results.length === 0 && <div className="search-results"><span className="muted small" style={{ padding: '6px 10px', display: 'block' }}>No players found.</span></div>}
    </div>
  );
}
