// PROTOTYPE: tiny presentational bits shared by the variants (no layout here).
'use client';

import type { KeyTouched, Mode, RunResult } from './stub';
import { INITIAL_STATUS } from './stub';

export function StatusBadge({ code }: { code: number }) {
  const c = code >= 500 ? 'bg-rose-500/20 text-rose-300' : code >= 400 ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-300';
  return <span className={`rounded px-1.5 py-0.5 font-mono text-xs ${c}`}>{code}</span>;
}

export function Json({ value }: { value: unknown }) {
  return <pre className="overflow-x-auto rounded bg-black/40 p-2 font-mono text-xs leading-relaxed text-zinc-300">{JSON.stringify(value, null, 2)}</pre>;
}

export function KeysTable({ keys, mode }: { keys: KeyTouched[]; mode: Mode }) {
  if (!keys.length) return <p className="text-xs text-zinc-500">No keys touched.</p>;
  return (
    <table className="w-full font-mono text-xs">
      <thead className="text-left text-zinc-500">
        <tr><th className="pr-2 font-normal">key</th><th className="pr-2 font-normal">type</th><th className="pr-2 font-normal">ttl</th>{mode === 'cluster' && <th className="font-normal">slot → node</th>}</tr>
      </thead>
      <tbody>
        {keys.map((k) => (
          <tr key={k.key} className="align-top">
            <td className="break-all pr-2 text-sky-300">{k.key}</td>
            <td className="pr-2">{k.type}</td>
            <td className="pr-2">{k.ttl ?? '∞'}</td>
            {mode === 'cluster' && <td className="whitespace-nowrap text-violet-300">{k.slot} → {k.node?.split(':')[1]}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function InsightLink({ mode, keyName }: { mode: Mode; keyName?: string }) {
  return (
    <a href={INITIAL_STATUS[mode].redisInsight} target="_blank" rel="noreferrer" className="text-xs text-sky-400 underline decoration-dotted hover:text-sky-300">
      Open {keyName ? 'key ' : ''}in RedisInsight ({mode}) ↗
    </a>
  );
}

export function Commands({ r }: { r: RunResult }) {
  return (
    <ul className="space-y-0.5 font-mono text-xs text-zinc-400">
      {r.commands.map((c, i) => <li key={i}>› {c}</li>)}
    </ul>
  );
}
