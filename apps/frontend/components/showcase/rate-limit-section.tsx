// The rate-limit section: the operation form (with Burst) beside a live window: count/limit cells, a countdown to
// resetAt, and one marker per call. Everything in the window comes from the package's results (allowed, remaining,
// resetAt, retryAfterSeconds); only the countdown ticks in the browser, towards the resetAt Redis returned.
'use client';

import { Gauge, Timer } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { runOperation, type RunResult } from '@/lib/showcase/api';
import { spec, type Values } from '@/lib/showcase/examples';
import { perMode } from '@/lib/showcase/per-mode';
import { useNow } from '@/lib/showcase/use-now';
import { RateLimitResultSchema, type Mode, type RateLimitResult } from '@showcase/contracts';
import { OpForm } from './op-form';

const BURST_GAP_MS = 100;
const MARKERS_KEPT = 60;

interface Marker { id: number; op: string; cost: number; result?: RateLimitResult; error?: string }
interface Pane { subject: string; window: RateLimitResult | null; markers: Marker[] }

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function RateLimitSection({ mode, onResult }: { mode: Mode; onResult: (r: RunResult) => void }) {
  const [panes, setPanes] = useState(() => perMode<Pane>(() => ({ subject: 'user:42', window: null, markers: [] })));
  const now = useNow();
  const pane = panes[mode];

  /** Sends one operation and turns its result into the pane's window and a marker. */
  const send = async (at: Mode, op: 'consume' | 'check' | 'reset', v: Values): Promise<RunResult> => {
    const r = await runOperation(at, 'rate-limit', op, () => spec('rate-limit', op).body!(v));
    const subject = String(v.subject);
    const parsed = RateLimitResultSchema.safeParse(r.body);
    const error = r.httpStatus === 200 ? undefined : (r.body as { error?: { code?: string } }).error?.code ?? 'error';
    const marker: Marker = { id: r.id, op, cost: v.cost === '' || v.cost === undefined ? 1 : Number(v.cost), result: parsed.data, error };
    setPanes((p) => {
      const prev = p[at];
      // A reset deletes the window; an error leaves it as it was.
      const window = parsed.success ? parsed.data : op === 'reset' && r.httpStatus === 200 ? null : prev.subject === subject ? prev.window : null;
      return { ...p, [at]: { subject, window, markers: [marker, ...prev.markers].slice(0, MARKERS_KEPT) } };
    });
    return r;
  };

  const run = async (op: string, v: Values): Promise<RunResult> => {
    if (op !== 'burst') return send(mode, op as 'consume' | 'check' | 'reset', v);
    // Burst: N consumes ~100 ms apart, each a real request. The result card sums them up; the trace lists every call.
    const at = mode, results: RunResult[] = [];
    for (let i = 0; i < Number(v.n); i++) {
      const started = Date.now();
      results.push(await send(at, 'consume', { subject: v.subject, cost: 1 }));
      await sleep(Math.max(0, BURST_GAP_MS - (Date.now() - started)));
    }
    const last = results.at(-1);
    const allowed = results.filter((r) => (r.body as { allowed?: boolean }).allowed === true).length;
    return {
      ...(last ?? { id: -1, at: new Date().toLocaleTimeString(), mode: at, module: 'rate-limit', httpStatus: 0, latencyMs: 0, keys: [] }),
      op: 'burst', input: JSON.stringify(v),
      latencyMs: +results.reduce((sum, r) => sum + r.latencyMs, 0).toFixed(1),
      body: { calls: results.length, allowed, denied: results.length - allowed, last: last?.body ?? null },
      commands: results.flatMap((r) => r.commands),
    };
  };

  const { window, markers } = pane;
  const left = window ? window.resetAt * 1000 - now : 0;
  const over = !!window && left <= 0;
  const limit = window?.limit ?? 10;
  const count = window?.count ?? 0;
  return (
    <div className="grid grid-cols-1 gap-4 @5xl:grid-cols-[minmax(0,1fr)_26rem]">
      <OpForm module="rate-limit" ops={['consume', 'check', 'reset', 'burst']} mode={mode} onRun={run} onResult={onResult} />
      <Card size="sm" className="self-start">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm"><Gauge className="size-4" /> showcase:rate-limit:{`{${pane.subject}}`}</CardTitle>
          <CardDescription>The mode clients allow 10 requests per 20 s window. Windows are aligned to the clock, so the first one may be short.</CardDescription>
          <CardAction>
            <Badge variant="outline" className="font-mono"><Timer /> {!window ? 'no window' : over ? 'window over' : `resets in ${(left / 1000).toFixed(1)}s`}</Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className={cn('flex gap-1', over && 'opacity-40')}>
            {Array.from({ length: limit }, (_, i) => <div key={i} className={cn('h-6 flex-1 rounded-sm', i < count ? (count >= limit ? 'bg-destructive' : 'bg-mode-standalone') : 'bg-muted')} />)}
          </div>
          <div className="font-mono text-xs text-muted-foreground">
            {window ? <>count {count} / {limit} · remaining {window.remaining}{over && ' · the next call starts a new window'}</> : 'Run consume or check to read the window.'}
          </div>
          <div className="flex flex-wrap gap-1">
            {markers.slice(0, 30).reverse().map((m) => {
              const neutral = m.op === 'reset' || !!m.error;
              return (
                <span key={m.id} title={JSON.stringify(m.error ?? m.result ?? m.op)}
                  className={cn('flex h-5 min-w-5 items-center justify-center rounded px-1 font-mono text-[10px]',
                    neutral ? 'bg-muted' : m.result?.allowed ? 'bg-success text-success-foreground' : 'bg-destructive text-background')}>
                  {m.op === 'reset' ? '↺' : m.error ? '·' : m.op === 'check' ? 'c' : m.result?.allowed ? m.cost : `${m.result?.retryAfterSeconds}s`}
                </span>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">Green: allowed (cost). Red: denied (retryAfterSeconds). c: check (green or red as it answered). ↺: reset. ·: an error.</p>
        </CardContent>
      </Card>
    </div>
  );
}
