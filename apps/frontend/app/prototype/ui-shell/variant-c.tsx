// PROTOTYPE variant C: console timeline. Icon rail, a composer with mode chips, and one history mixing runs and events; a detail pane for the selected run.
'use client';

import { useMemo, useState } from 'react';
import { Commands, InsightLink, Json, KeysTable, StatusBadge } from './bits';
import { MODES, MODULES, healthDot, runOp, useStubLive, type Mode, type RunResult, type ShowcaseEvent } from './stub';

export const name = 'Console timeline';

type Entry = { t: number; kind: 'run'; runs: RunResult[]; label: string } | { t: number; kind: 'event'; e: ShowcaseEvent };

export function VariantC() {
  const { status, events, simulateFailover } = useStubLive();
  const [moduleId, setModuleId] = useState('cache');
  const mod = MODULES.find((m) => m.id === moduleId)!;
  const [opId, setOpId] = useState(mod.ops[0].id);
  const op = mod.ops.find((o) => o.id === opId) ?? mod.ops[0];
  const [input, setInput] = useState(op.input);
  const [chips, setChips] = useState<Mode[]>(['standalone', 'cluster']);
  const [history, setHistory] = useState<Array<{ t: number; runs: RunResult[]; label: string }>>([]);
  const [selected, setSelected] = useState<RunResult | null>(null);
  const [showEvents, setShowEvents] = useState(true);

  const pick = (id: string) => {
    const m = MODULES.find((x) => x.id === id)!;
    setModuleId(id); setOpId(m.ops[0].id); setInput(m.ops[0].input);
    if (m.onlyMode) setChips([m.onlyMode]);
  };
  const run = () => {
    const modes = mod.onlyMode ? [mod.onlyMode] : chips;
    const runs = modes.map((md) => runOp(md, moduleId, op.id, input, status[md]));
    setHistory((h) => [{ t: Date.now(), runs, label: `${mod.id}.${op.label}(${input})` }, ...h]);
    setSelected(runs[0] ?? null);
    if (mod.id === 'failover') simulateFailover();
  };

  const timeline = useMemo<Entry[]>(() => {
    const ev: Entry[] = showEvents ? events.map((e) => ({ t: e.id * -1, kind: 'event' as const, e })) : [];
    // interleave: runs carry real timestamps, events are newest-first already; merge by arrival order
    const runs: Entry[] = history.map((h) => ({ ...h, kind: 'run' as const }));
    const out: Entry[] = []; let i = 0, j = 0;
    while (i < runs.length || j < ev.length) {
      if (j >= ev.length || (i < runs.length && i <= j)) out.push(runs[i++]); else out.push(ev[j++]);
    }
    return out;
  }, [history, events, showEvents]);

  return (
    <div className="flex h-screen">
      {/* icon rail */}
      <nav className="flex w-16 flex-col items-center gap-1 border-r border-zinc-800 bg-zinc-900 py-3">
        {MODULES.map((m) => (
          <button key={m.id} onClick={() => pick(m.id)} title={m.label}
            className={`flex h-11 w-11 flex-col items-center justify-center rounded-lg text-[10px] leading-tight ${moduleId === m.id ? 'bg-sky-600 text-white' : 'text-zinc-400 hover:bg-zinc-800'} ${m.kind === 'mode-specific' ? 'mt-2 ring-1 ring-violet-500/50' : ''}`}>
            <span className="text-sm font-bold">{m.label.slice(0, 2)}</span>{m.onlyMode?.slice(0, 4)}
          </button>
        ))}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* status strip */}
        <div className="flex items-center gap-4 border-b border-zinc-800 px-5 py-2 text-xs">
          {MODES.map((md) => (
            <span key={md} className="flex items-center gap-2 rounded-full border border-zinc-800 px-3 py-1">
              <span className={`h-2 w-2 rounded-full ${healthDot[status[md].health]}`} />{md}<span className="font-mono text-zinc-500">{status[md].latencyMs}ms</span>
              {md === 'sentinel' && <span className={status.sentinel.failoverReady ? 'text-emerald-400' : 'text-rose-400'}>{status.sentinel.failoverReady ? 'failover-ready' : 'not failover-ready'}</span>}
            </span>
          ))}
          <label className="ml-auto flex items-center gap-1 text-zinc-500"><input type="checkbox" checked={showEvents} onChange={(e) => setShowEvents(e.target.checked)} /> show events in timeline</label>
        </div>

        {/* composer */}
        <div className="border-b border-zinc-800 bg-zinc-900/50 px-5 py-4">
          <div className="flex items-center gap-2 font-mono text-sm">
            <span className="text-zinc-500">{mod.label.toLowerCase()}.</span>
            <select value={op.id} onChange={(e) => { setOpId(e.target.value); setInput(mod.ops.find((o) => o.id === e.target.value)!.input); }} className="rounded bg-zinc-800 px-2 py-1">
              {mod.ops.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <span className="text-zinc-500">(</span>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={op.placeholder} onKeyDown={(e) => e.key === 'Enter' && run()} className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-zinc-600" />
            <span className="text-zinc-500">)</span>
            <span className="text-zinc-500">on</span>
            {MODES.map((md) => {
              const on = mod.onlyMode ? mod.onlyMode === md : chips.includes(md);
              return (
                <button key={md} disabled={!!mod.onlyMode} onClick={() => setChips(on ? chips.filter((c) => c !== md) : [...chips, md])}
                  className={`rounded-full px-2.5 py-0.5 text-xs ${on ? 'bg-sky-600 text-white' : 'bg-zinc-800 text-zinc-500'} disabled:cursor-not-allowed`}>{md}</button>
              );
            })}
            <button onClick={run} className="rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-white">⏎ run</button>
          </div>
          <div className="mt-1 text-xs text-zinc-500">{mod.blurb}</div>
        </div>

        {/* timeline */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 pb-16">
          {!timeline.length && <p className="text-sm text-zinc-500">Type an operation and press Enter. Runs and background events pile up here, newest first.</p>}
          <ol className="space-y-2">
            {timeline.map((en, idx) => en.kind === 'event' ? (
              <li key={`e${en.e.id}`} className="flex gap-3 border-l-2 border-amber-500/40 pl-3 font-mono text-[11px]">
                <span className="text-zinc-600">{en.e.at}</span><span className="text-zinc-400">{en.e.mode}</span><span className={en.e.kind === 'error' ? 'text-rose-300' : 'text-amber-200'}>{en.e.text}</span>
              </li>
            ) : (
              <li key={`r${idx}`} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                <div className="mb-2 font-mono text-sm text-zinc-200">{en.label}</div>
                <div className="space-y-1">
                  {en.runs.map((r) => (
                    <button key={r.id} onClick={() => setSelected(r)} className={`flex w-full items-center gap-3 rounded px-2 py-1 text-left font-mono text-xs ${selected?.id === r.id ? 'bg-sky-600/20' : 'hover:bg-zinc-800'}`}>
                      <span className="w-20 text-zinc-400">{r.mode}</span><StatusBadge code={r.httpStatus} /><span className="w-14 text-zinc-500">{r.latencyMs}ms</span>
                      <span className="truncate text-zinc-300">{JSON.stringify(r.body)}</span>
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>

      {/* detail pane */}
      <aside className="w-96 overflow-y-auto border-l border-zinc-800 bg-zinc-900/60 p-4 pb-16">
        {selected ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between"><h3 className="font-semibold">{selected.mode} · {selected.module}.{selected.op}</h3><StatusBadge code={selected.httpStatus} /></div>
            <Json value={selected.body} />
            <div><div className="mb-1 text-xs uppercase text-zinc-500">Keys touched</div><KeysTable keys={selected.keys} mode={selected.mode} /></div>
            <div><div className="mb-1 text-xs uppercase text-zinc-500">Commands</div><Commands r={selected} /></div>
            <InsightLink mode={selected.mode} />
            <code className="block break-all rounded bg-black/40 p-2 text-[11px] text-zinc-400">{status[selected.mode].cli}</code>
          </div>
        ) : <p className="text-sm text-zinc-500">Select a run to inspect its keys, commands and links.</p>}
      </aside>
    </div>
  );
}
