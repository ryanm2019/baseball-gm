import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { League, Level, Player } from '../core/types.ts';
import { LEVELS } from '../core/types.ts';
import { href } from '../router.ts';
import { askConfirm, changed, setMessage } from '../store.ts';
import { playerActions } from './actions.ts';
import { orgById } from '../core/util.ts';

export interface Column<T> {
  key: string;
  label: ReactNode;
  title?: string;
  left?: boolean;
  value?: (row: T) => number | string;
  render?: (row: T) => ReactNode;
  sortDesc?: boolean; // default sort direction for this column
  noSort?: boolean;
}

// Sort choices are remembered per table (page + columns), across visits and reloads.
type Sort = { key: string; desc: boolean } | null;
const SORT_KEY = 'bgm-sorts';
let sortMemory: Record<string, Sort> | null = null;
function sorts(): Record<string, Sort> {
  if (!sortMemory) {
    try { sortMemory = JSON.parse(localStorage.getItem(SORT_KEY) ?? '{}') ?? {}; } catch { sortMemory = {}; }
  }
  return sortMemory!;
}
function saveSort(id: string, s: Sort): void {
  sorts()[id] = s;
  try { localStorage.setItem(SORT_KEY, JSON.stringify(sortMemory)); } catch { /* storage unavailable */ }
}

export function DataTable<T>({
  cols,
  rows,
  defaultSort,
  rowClass,
  rowKey,
  compact,
  footer,
  maxHeight,
}: {
  maxHeight?: number; // scroll inside a box this tall (header sticks to the box)
  cols: Column<T>[];
  rows: T[];
  defaultSort?: { key: string; desc: boolean };
  rowClass?: (row: T) => string | undefined;
  rowKey: (row: T) => string | number;
  compact?: boolean;
  footer?: ReactNode;
}) {
  const sortId = `${window.location.hash.replace(/^#\/?/, '').split(/[/?]/)[0]}|${cols.map((c) => c.key).join(',')}`;
  const [sort, setSortState] = useState<Sort>(() => {
    const saved = sorts()[sortId];
    return saved && cols.some((c) => c.key === saved.key) ? saved : defaultSort ?? null;
  });
  const setSort = (s: Sort) => { setSortState(s); saveSort(sortId, s); };
  // Tables that fit the width scroll with the page (header sticks under the top bar);
  // wider ones scroll inside their own box (header sticks to the box).
  const wrap = useRef<HTMLDivElement>(null);
  const [fits, setFits] = useState(true);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const check = () => {
      const t = el.querySelector('table');
      if (t) setFits(t.scrollWidth <= el.clientWidth + 1);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [rows.length, cols.length]);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = cols.find((c) => c.key === sort.key);
    if (!col || !col.value) return rows;
    const v = col.value;
    const out = [...rows].sort((a, b) => {
      const x = v(a);
      const y = v(b);
      if (typeof x === 'number' && typeof y === 'number') return x - y;
      return String(x).localeCompare(String(y));
    });
    if (sort.desc) out.reverse();
    return out;
  }, [rows, sort, cols]);
  return (
    <div className={`table-wrap${fits && !maxHeight ? ' fits' : ''}`} ref={wrap} style={maxHeight ? { maxHeight } : undefined}>
      <table className={`data${compact ? ' compact' : ''}`}>
        <thead>
          <tr>
            {cols.map((c) => {
              const sortable = !!c.value && !c.noSort;
              const isSorted = sort?.key === c.key;
              return (
                <th
                  key={c.key}
                  title={c.title}
                  className={[c.left ? 'l' : '', sortable ? 'sortable' : '', isSorted ? 'sorted' : '', isSorted && !sort!.desc ? 'asc' : ''].join(' ')}
                  onClick={() => {
                    if (!sortable) return;
                    if (isSorted) setSort({ key: c.key, desc: !sort!.desc });
                    else setSort({ key: c.key, desc: c.sortDesc ?? !c.left });
                  }}
                >
                  {c.label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={rowKey(r)} className={rowClass?.(r)}>
              {cols.map((c) => (
                <td key={c.key} className={c.left ? 'l' : ''}>
                  {c.render ? c.render(r) : c.value ? c.value(r) : null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer}
      </table>
      {rows.length === 0 && <p className="muted">None.</p>}
    </div>
  );
}

export function PlayerLink({ p }: { p: Player }) {
  return <a href={href('player', [p.id])}>{p.first} {p.last}</a>;
}

export function OrgLink({ league, orgId, level = 'MLB', abbrev }: { league: League; orgId: number | null; level?: Level; abbrev?: boolean }) {
  const o = orgById(league, orgId);
  if (!o) return <span className="muted">FA</span>;
  const name = abbrev ? (level === 'MLB' ? o.abbrev : `${o.abbrev} ${level}`) : o.affiliates[level].name;
  return <a href={href('roster', [], { org: o.id, level })}>{name}</a>;
}

export function Rating({ v }: { v: number }) {
  const cls = v >= 70 ? 'r80' : v >= 60 ? 'r60' : v >= 45 ? 'r50' : v >= 35 ? 'r40' : 'r20';
  return <span className={`rating ${cls}`}>{v}</span>;
}

export function LevelTabs({ value, onChange, extra }: { value: string; onChange: (v: string) => void; extra?: { key: string; label: string }[] }) {
  const items = [...LEVELS.map((l) => ({ key: l, label: l })), ...(extra ?? [])];
  return (
    <div className="tabs btn-group">
      {items.map((it) => (
        <button key={it.key} className={`btn btn-sm${value === it.key ? ' active' : ''}`} onClick={() => onChange(it.key)}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function OrgSelect({ league, value, onChange }: { league: League; value: number; onChange: (id: number) => void }) {
  const sorted = [...league.orgs].sort((a, b) => a.region.localeCompare(b.region));
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {sorted.map((o) => (
        <option key={o.id} value={o.id}>
          {o.region} {o.name}
        </option>
      ))}
    </select>
  );
}

export function ActionSelect({ league, p }: { league: League; p: Player }) {
  const actions = playerActions(league, p);
  if (!actions.length) return null;
  return (
    <select
      className="move"
      value=""
      onChange={async (e) => {
        const a = actions.find((x) => x.key === e.target.value);
        if (!a || a.reason) return;
        if (a.confirm && !(await askConfirm(a.confirm))) return;
        a.run();
        setMessage(null);
        changed();
      }}
    >
      <option value="">Move…</option>
      {actions.map((a) => (
        <option key={a.key} value={a.key} disabled={!!a.reason}>
          {a.label}
          {a.reason ? ` (${a.reason})` : ''}
        </option>
      ))}
    </select>
  );
}

export function StatusTags({ league, p }: { league: League; p: Player }) {
  return (
    <>
      {p.il && <span className="tag tag-il">{p.il.type.replace('IL', 'IL-').replace('MiLB', 'MiLB IL-').replace('IL-IL', 'IL')}</span>}
      {!p.il && p.injury && <span className="tag tag-il" title={p.injury.name}>inj {p.injury.daysLeft}d</span>}
      {p.dfa && <span className="tag tag-dfa">DFA</span>}
      {p.waivers && <span className="tag tag-dfa">Waivers</span>}
      {p.on40 && p.level !== 'MLB' && !p.il && <span className="tag tag-opt">40</span>}
      {p.optionedOnDay !== null && p.on40 && p.level !== 'MLB' && league.day - p.optionedOnDay < 15 && <span className="tag">opt</span>}
      {p.orgId !== null && league.orgs[p.orgId]?.block.includes(p.id) && <span className="tag tag-block" title="On his team's trading block">block</span>}
    </>
  );
}

// Text with the named players turned into links to their pages.
export function LinkedText({ league, text, pids }: { league: League; text: string; pids: number[] }) {
  const names = pids
    .map((id) => league.players[id])
    .filter(Boolean)
    .map((p) => ({ id: p.id, name: `${p.first} ${p.last}` }))
    .sort((a, b) => b.name.length - a.name.length);
  if (!names.length) return <>{text}</>;
  const out: ReactNode[] = [];
  let rest = text;
  let k = 0;
  while (rest) {
    let hit: { i: number; id: number; name: string } | null = null;
    for (const n of names) {
      const i = rest.indexOf(n.name);
      if (i >= 0 && (!hit || i < hit.i)) hit = { i, ...n };
    }
    if (!hit) {
      out.push(rest);
      break;
    }
    if (hit.i > 0) out.push(rest.slice(0, hit.i));
    out.push(<a key={k++} href={href('player', [hit.id])}>{hit.name}</a>);
    rest = rest.slice(hit.i + hit.name.length);
  }
  return <>{out}</>;
}
