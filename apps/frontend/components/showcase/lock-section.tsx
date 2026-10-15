// The lock section: one lease with a live TTL bar and two holder lanes (A and B) on top, the operation form below.
'use client';

import { Lock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { Values } from '@/lib/showcase/examples';
import type { Mode } from '@showcase/contracts';
import { useLockSim, type Lane } from '@/lib/showcase/mock-live';
import { OpForm } from './op-form';

const LANES: Lane[] = ['A', 'B'];
const secs = (ms: number) => `${Math.max(0, ms / 1000).toFixed(1)}s`;

export function LockSection({ mode }: { mode: Mode }) {
  const lock = useLockSim();
  const { lease, now } = lock;
  const left = lease ? lease.expiresAt - now : 0;
  const tokenOf = (v: string) => (v === '$A' ? lock.tokens.A[0] ?? '' : v === '$B' ? lock.tokens.B[0] ?? '' : v);
  const run = (op: string, v: Values) => {
    const lane = v.lane as Lane;
    if (op === 'acquire') return lock.acquire(lane, String(v.name), Number(v.ttl)).body;
    if (op === 'extend') return lock.extend(lane, tokenOf(String(v.token)), Number(v.ttl)).body;
    if (op === 'release') return lock.release(lane, tokenOf(String(v.token))).body;
    return lock.using(lane, 'report:nightly', Number(v.work), Number(v.ttl)).body;
  };
  const tokens = [
    { value: '$A', label: `A's last token${lock.tokens.A[0] ? ` (${lock.tokens.A[0]})` : ' (none)'}` },
    { value: '$B', label: `B's last token${lock.tokens.B[0] ? ` (${lock.tokens.B[0]})` : ' (none)'}` },
    ...LANES.flatMap((l) => lock.tokens[l].slice(1).map((t) => ({ value: t, label: `${l} · ${t}` }))),
  ];
  return (
    <div className="space-y-4">
      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm"><Lock className="size-4" /> showcase:lock:report:nightly</CardTitle>
          <CardDescription>One lease, two holders. The bar is the key&apos;s remaining TTL.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="h-3 overflow-hidden rounded-full bg-muted">
            <div className={cn('h-full transition-[width] duration-100', lease ? 'bg-mode-standalone' : 'bg-transparent')} style={{ width: `${lease ? Math.min(100, (left / 30000) * 100) : 0}%` }} />
          </div>
          <div className="font-mono text-xs text-muted-foreground">
            {lease ? <>held by <span className="font-medium text-foreground">{lease.lane}</span> · {secs(left)} left · token {lease.token}{lease.using && lease.using > now && <> · working {secs(lease.using - now)}</>}</> : 'free'}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {LANES.map((lane) => {
              const holds = lease?.lane === lane;
              return (
                <div key={lane} className={cn('space-y-2 rounded-lg border p-3', holds && 'border-success ring-1 ring-success')}>
                  <div className="flex items-center justify-between text-sm font-medium">Holder {lane} {holds ? <Badge className="bg-success text-success-foreground">holds</Badge> : <Badge variant="outline">waiting</Badge>}</div>
                  <ul className="space-y-0.5 font-mono text-[11px] text-muted-foreground">
                    {lock.tokens[lane].map((t, i) => <li key={t} className={cn(i === 0 && 'text-foreground')}>{t}{lease?.token === t && ' ← lease'}</li>)}
                    {!lock.tokens[lane].length && <li>no tokens yet</li>}
                  </ul>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
      <OpForm module="lock" ops={['acquire', 'extend', 'release', 'using']} mode={mode} tokens={tokens} onRun={run} />
    </div>
  );
}
