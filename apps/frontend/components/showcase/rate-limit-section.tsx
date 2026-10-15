// The rate-limit section: the operation form (with Burst) beside a live window: count/limit cells, a countdown to
// resetAt, and one marker per call.
'use client';

import { Gauge, Timer } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { Values } from '@/lib/showcase/examples';
import type { Mode } from '@/lib/showcase/mock-backend';
import { RL, useRateSim } from '@/lib/showcase/mock-live';
import { OpForm } from './op-form';

const secs = (ms: number) => `${Math.max(0, ms / 1000).toFixed(1)}s`;

export function RateLimitSection({ mode }: { mode: Mode }) {
  const rate = useRateSim();
  const { win, now, log } = rate;
  const count = win?.count ?? 0;
  const run = (op: string, v: Values) => {
    if (op === 'consume') return rate.consume(String(v.subject), Number(v.cost));
    if (op === 'check') return rate.check();
    if (op === 'reset') return rate.reset();
    rate.burst(String(v.subject), Number(v.n));
    return { sent: Number(v.n), note: 'watch the window fill' };
  };
  return (
    <div className="grid grid-cols-1 gap-4 @5xl:grid-cols-[minmax(0,1fr)_26rem]">
      <OpForm module="rate-limit" ops={['consume', 'check', 'reset', 'burst']} mode={mode} onRun={run} />
      <Card size="sm" className="self-start">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm"><Gauge className="size-4" /> showcase:rate-limit:{'{user:42}'}</CardTitle>
          <CardDescription>{RL.limit} requests per {RL.windowS} s window.</CardDescription>
          <CardAction><Badge variant="outline" className="font-mono"><Timer /> {win ? `resets in ${secs(win.start + RL.windowS * 1000 - now)}` : 'no window'}</Badge></CardAction>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-1">
            {Array.from({ length: RL.limit }, (_, i) => <div key={i} className={cn('h-6 flex-1 rounded-sm', i < count ? (count >= RL.limit ? 'bg-destructive' : 'bg-mode-standalone') : 'bg-muted')} />)}
          </div>
          <div className="font-mono text-xs text-muted-foreground">count {count} / {RL.limit} · remaining {Math.max(0, RL.limit - count)}</div>
          <div className="flex flex-wrap gap-1">
            {log.slice(0, 30).reverse().map((e) => {
              const r = e.r as { allowed?: boolean; retryAfterSeconds?: number; error?: unknown };
              const neutral = e.op === 'reset' || !!r.error;
              return (
                <span key={e.id} title={JSON.stringify(e.r)} className={cn('flex h-5 min-w-5 items-center justify-center rounded px-1 font-mono text-[10px]', neutral ? 'bg-muted' : r.allowed ? 'bg-success text-success-foreground' : 'bg-destructive text-background')}>
                  {e.op === 'reset' ? '↺' : e.op === 'check' ? 'c' : r.error ? '·' : r.allowed ? e.cost : `${r.retryAfterSeconds}s`}
                </span>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">Green: allowed (cost). Red: denied (retryAfterSeconds). c: check. ↺: reset.</p>
        </CardContent>
      </Card>
    </div>
  );
}
