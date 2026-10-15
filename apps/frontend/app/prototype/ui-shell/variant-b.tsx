// PROTOTYPE variant B: mode matrix. Modules as top tabs; three mode columns are always on screen, each a self-contained lane.
'use client';

import { useState } from 'react';
import { Commands, InsightLink, Json, KeysTable, StatusBadge } from './bits';
import { MODES, MODULES, healthDot, runOp, useStubLive, type Mode, type RunResult } from './stub';

export const name = 'Mode matrix, three lanes';

export function VariantB() {
  const { status, events, simulateFailover } = useStubLive();
  const [moduleId, setModuleId] = useState('cache');
  const mod = MODULES.find((m) => m.id === moduleId)!;
  const [opId, setOpId] = useState(mod.ops[0].id);
  const op = mod.ops.find((o) => o.id === opId) ?? mod.ops[0];
  const [input, setInput] = useState(op.input);
  const [targets, setTargets] = useState<Record<Mode, boolean>>({ standalone: true, sentinel: true, cluster: true });
  const [last, setLast] = useState<Partial<Record<Mode, RunResult>>>({});

  const applies = (md: Mode) => !mod.onlyMode || mod.onlyMode === md;
  const pick = (id: string) => {
    const m = MODULES.find((x) => x.id === id)!;
    setModuleId(id); setOpId(m.ops[0].id); setInput(m.ops[0].input); setLast({});
  };
  const run = (only?: Mode) => {
    const next: Partial<Record<Mode, RunResult>> = { ...last };
    for (const md of MODES) if (applies(md) && (only ? md === only : targets[md])) next[md] = runOp(md, moduleId, op.id, input, status[md]);
    setLast(next);
  };

  return (
    <div className="flex h-screen flex-col">
      {/* top bar: module tabs */}
      <header className="flex items-center gap-6 border-b border-zinc-800 bg-zinc-900 px-5">
        <div className="py-3 text-sm font-bold">ioredis-toolkit</div>
        <nav className="flex gap-1 overflow-x-auto">
          {MODULES.map((m) => (
            <button key={m.id} onClick={() => pick(m.id)} className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm ${moduleId === m.id ? 'border-sky-400 text-white' : 'border-transparent text-zinc-400 hover:text-zinc-200'}`}>
              {m.label}{m.onlyMode && <span className="ml-1 rounded bg-violet-500/20 px-1 text-[10px] text-violet-300">{m.onlyMode}</span>}
            </button>
          ))}
        </nav>
      </header>

      {/* operation bar, spans all lanes */}
      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-800 px-5 py-3">
        <span className="text-sm text-zinc-400">{mod.blurb}</span>
        <div className="ml-auto flex items-center gap-2">
          <select value={op.id} onChange={(e) => { setOpId(e.target.value); setInput(mod.ops.find((o) => o.id === e.target.value)!.input); }} className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 font-mono text-sm">
            {mod.ops.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          {op.placeholder && <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={op.placeholder} className="w-56 rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 font-mono text-sm" />}
          {!mod.onlyMode && MODES.map((md) => (
            <label key={md} className="flex items-center gap-1 text-xs text-zinc-400"><input type="checkbox" checked={targets[md]} onChange={(e) => setTargets({ ...targets, [md]: e.target.checked })} />{md}</label>
          ))}
          <button onClick={() => run()} className="rounded bg-sky-600 px-4 py-1.5 text-sm font-medium hover:bg-sky-500">Run {mod.onlyMode ? `on ${mod.onlyMode}` : 'on selected'}</button>
        </div>
      </div>

      {/* three lanes */}
      <div className="grid min-h-0 flex-1 grid-cols-3 divide-x divide-zinc-800">
        {MODES.map((md) => {
          const s = status[md];
          const r = last[md];
          const lane = events.filter((e) => e.mode === md);
          return (
            <section key={md} className={`flex min-h-0 flex-col ${applies(md) ? '' : 'opacity-35'}`}>
              <div className="border-b border-zinc-800 bg-zinc-900/60 p-4">
                <div className="flex items-center justify-between">
                  <h2 className="flex items-center gap-2 text-lg font-semibold"><span className={`h-2.5 w-2.5 rounded-full ${healthDot[s.health]}`} />{md}</h2>
                  <span className="font-mono text-xs text-zinc-400">{s.health} · {s.latencyMs}ms</span>
                </div>
                <div className="mt-1 text-xs text-zinc-500">{s.detail.join(' · ')}</div>
                {s.failoverReady !== undefined && <div className="mt-1 text-xs">failoverReady <span className={s.failoverReady ? 'text-emerald-300' : 'text-rose-300'}>{String(s.failoverReady)}</span></div>}
                <div className="mt-2 flex gap-3"><InsightLink mode={md} />{applies(md) && <button onClick={() => run(md)} className="text-xs text-sky-400 underline decoration-dotted">run here only</button>}</div>
              </div>
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                {!applies(md) && <p className="text-sm text-zinc-400">{mod.label} only exists on {mod.onlyMode}.</p>}
                {applies(md) && md === 'sentinel' && mod.id === 'failover' && (
                  <button onClick={simulateFailover} className="rounded border border-amber-500 px-3 py-1.5 text-sm text-amber-300">simulate failover in status</button>
                )}
                {r ? (
                  <>
                    <div className="flex items-center justify-between text-xs text-zinc-500"><span>{r.at} · {r.op}({r.input})</span><span className="flex items-center gap-2 font-mono">{r.latencyMs}ms <StatusBadge code={r.httpStatus} /></span></div>
                    <Json value={r.body} />
                    <div><div className="mb-1 text-xs uppercase text-zinc-500">Keys</div><KeysTable keys={r.keys} mode={md} /></div>
                    <div><div className="mb-1 text-xs uppercase text-zinc-500">Commands</div><Commands r={r} /></div>
                  </>
                ) : applies(md) && <p className="text-sm text-zinc-600">No run yet.</p>}
              </div>
              <ul className="h-28 overflow-y-auto border-t border-zinc-800 bg-black/30 px-4 py-2 pb-12 font-mono text-[11px]">
                {lane.map((e) => <li key={e.id} className={e.kind === 'error' ? 'text-rose-300' : 'text-amber-200'}><span className="text-zinc-600">{e.at}</span> {e.text}</li>)}
                {!lane.length && <li className="text-zinc-600">event log: quiet</li>}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
