// PROTOTYPE variant A: sidebar app, one mode at a time, compare toggle, right-hand Redis state rail, event log drawer.
'use client';

import { useState } from 'react';
import { Commands, InsightLink, Json, KeysTable, StatusBadge } from './bits';
import { MODES, MODULES, healthDot, runOp, useStubLive, type Mode, type RunResult } from './stub';

export const name = 'Sidebar, one mode at a time';

export function VariantA() {
  const { status, events, simulateFailover } = useStubLive();
  const [mode, setMode] = useState<Mode>('standalone');
  const [moduleId, setModuleId] = useState('cache');
  const mod = MODULES.find((m) => m.id === moduleId)!;
  const [opId, setOpId] = useState(mod.ops[0].id);
  const op = mod.ops.find((o) => o.id === opId) ?? mod.ops[0];
  const [input, setInput] = useState(op.input);
  const [compare, setCompare] = useState(false);
  const [results, setResults] = useState<RunResult[]>([]);
  const [drawer, setDrawer] = useState(true);

  const pickModule = (id: string) => {
    const m = MODULES.find((x) => x.id === id)!;
    setModuleId(id); setOpId(m.ops[0].id); setInput(m.ops[0].input); setResults([]);
    if (m.onlyMode) { setMode(m.onlyMode); setCompare(false); }
  };
  const run = () => {
    const modes = compare ? MODES : [mode];
    setResults(modes.map((md) => runOp(md, moduleId, op.id, input, status[md])));
  };
  const focus = results.find((r) => r.mode === mode) ?? results[0];

  return (
    <div className="flex h-screen flex-col">
      <div className="flex min-h-0 flex-1">
        {/* sidebar */}
        <aside className="flex w-60 flex-col gap-6 border-r border-zinc-800 bg-zinc-900 p-4">
          <div className="text-sm font-bold tracking-wide">ioredis-toolkit <span className="text-zinc-500">showcase</span></div>
          <div>
            <div className="mb-2 text-xs uppercase text-zinc-500">Connection mode</div>
            <div className="flex flex-col gap-1">
              {MODES.map((md) => (
                <button key={md} onClick={() => { setMode(md); setResults([]); }} disabled={!!mod.onlyMode && mod.onlyMode !== md}
                  className={`flex items-center justify-between rounded px-2 py-1.5 text-left text-sm disabled:opacity-30 ${mode === md ? 'bg-zinc-700' : 'hover:bg-zinc-800'}`}>
                  <span className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${healthDot[status[md].health]}`} />{md}</span>
                  <span className="font-mono text-xs text-zinc-500">{status[md].latencyMs}ms</span>
                </button>
              ))}
            </div>
          </div>
          <nav>
            <div className="mb-2 text-xs uppercase text-zinc-500">Feature modules</div>
            {MODULES.filter((m) => m.kind === 'feature').map((m) => (
              <button key={m.id} onClick={() => pickModule(m.id)} className={`block w-full rounded px-2 py-1 text-left text-sm ${moduleId === m.id ? 'bg-sky-600/30 text-sky-200' : 'hover:bg-zinc-800'}`}>{m.label}</button>
            ))}
            <div className="mb-2 mt-4 text-xs uppercase text-zinc-500">Mode-specific</div>
            {MODULES.filter((m) => m.kind === 'mode-specific').map((m) => (
              <button key={m.id} onClick={() => pickModule(m.id)} className={`flex w-full justify-between rounded px-2 py-1 text-left text-sm ${moduleId === m.id ? 'bg-violet-600/30 text-violet-200' : 'hover:bg-zinc-800'}`}>
                {m.label}<span className="text-xs text-zinc-500">{m.onlyMode}</span>
              </button>
            ))}
          </nav>
        </aside>

        {/* main */}
        <main className="min-w-0 flex-1 overflow-y-auto p-6">
          <h1 className="text-2xl font-semibold">{mod.label} <span className="text-base font-normal text-zinc-500">on {compare ? 'all modes' : mode}</span></h1>
          <p className="mb-5 text-sm text-zinc-400">{mod.blurb}</p>
          <div className="mb-3 flex gap-1 border-b border-zinc-800">
            {mod.ops.map((o) => (
              <button key={o.id} onClick={() => { setOpId(o.id); setInput(o.input); }} className={`-mb-px border-b-2 px-3 py-1.5 font-mono text-sm ${o.id === op.id ? 'border-sky-400 text-sky-200' : 'border-transparent text-zinc-400'}`}>{o.label}</button>
            ))}
          </div>
          <div className="mb-6 flex items-center gap-3">
            {op.placeholder && <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={op.placeholder} className="w-72 rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 font-mono text-sm" />}
            <button onClick={run} className="rounded bg-sky-600 px-4 py-1.5 text-sm font-medium hover:bg-sky-500">Run</button>
            {!mod.onlyMode && (
              <label className="flex items-center gap-2 text-sm text-zinc-400"><input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} /> compare across all modes</label>
            )}
            {mod.id === 'failover' && <button onClick={simulateFailover} className="rounded border border-amber-500 px-3 py-1.5 text-sm text-amber-300">simulate failover in status</button>}
          </div>
          <div className={`grid gap-4 ${results.length > 1 ? 'grid-cols-3' : 'grid-cols-1'}`}>
            {results.map((r) => (
              <section key={r.id} onClick={() => setMode(r.mode)} className={`cursor-pointer rounded-lg border p-3 ${r.mode === focus?.mode ? 'border-sky-500/60' : 'border-zinc-800'}`}>
                <div className="mb-2 flex items-center justify-between text-sm"><span className="font-semibold">{r.mode}</span><span className="flex items-center gap-2 font-mono text-xs text-zinc-500">{r.latencyMs}ms <StatusBadge code={r.httpStatus} /></span></div>
                <Json value={r.body} />
              </section>
            ))}
            {!results.length && <p className="text-sm text-zinc-500">Run an operation to see its result here.</p>}
          </div>
        </main>

        {/* right rail: raw Redis state */}
        <aside className="w-80 overflow-y-auto border-l border-zinc-800 bg-zinc-900/60 p-4">
          <div className="mb-3 text-xs uppercase text-zinc-500">Redis state · {focus?.mode ?? mode}</div>
          {focus ? (
            <div className="space-y-4">
              <div><div className="mb-1 text-xs text-zinc-500">Keys touched</div><KeysTable keys={focus.keys} mode={focus.mode} /></div>
              <div><div className="mb-1 text-xs text-zinc-500">Commands sent</div><Commands r={focus} /></div>
            </div>
          ) : <p className="text-xs text-zinc-500">Nothing yet.</p>}
          <div className="mt-6 space-y-2 border-t border-zinc-800 pt-4">
            <div className="text-xs text-zinc-500">{status[mode].detail.join(' · ')}</div>
            {status[mode].failoverReady !== undefined && <div className="text-xs">failoverReady: <span className={status[mode].failoverReady ? 'text-emerald-300' : 'text-rose-300'}>{String(status[mode].failoverReady)}</span></div>}
            <InsightLink mode={focus?.mode ?? mode} />
            <div className="text-xs text-zinc-500">redis-cli:</div>
            <code className="block break-all rounded bg-black/40 p-2 text-[11px] text-zinc-400">{status[mode].cli}</code>
          </div>
        </aside>
      </div>

      {/* bottom drawer: event log */}
      <div className="border-t border-zinc-800 bg-zinc-900">
        <button onClick={() => setDrawer(!drawer)} className="flex w-full items-center justify-between px-4 py-1.5 text-xs text-zinc-400">
          <span>Event log (all modes) · {events.length}</span><span>{drawer ? '▾' : '▴'}</span>
        </button>
        {drawer && (
          <ul className="h-32 overflow-y-auto px-4 pb-10 font-mono text-xs">
            {events.map((e) => (
              <li key={e.id} className="flex gap-3 py-0.5"><span className="text-zinc-600">{e.at}</span><span className="w-20 text-zinc-400">{e.mode}</span><span className={e.kind === 'error' ? 'text-rose-300' : 'text-amber-200'}>{e.text}</span></li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
