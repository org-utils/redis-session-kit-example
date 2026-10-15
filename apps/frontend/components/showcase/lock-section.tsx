// The lock section: one lease with a live TTL bar and two holder lanes (A and B) on top, the operation form below. The
// bar and the holds badges come from Redis (the key's token and PTTL); each lane keeps the tokens it was handed.
'use client';

import { Lock } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { runOperation, type RunResult } from '@/lib/showcase/api';
import { spec, type Values } from '@/lib/showcase/examples';
import { perMode } from '@/lib/showcase/per-mode';
import { useLease } from '@/lib/showcase/use-lease';
import { useNow } from '@/lib/showcase/use-now';
import type { Mode } from '@showcase/contracts';
import { OpForm } from './op-form';

type Lane = 'A' | 'B';
const LANES: Lane[] = ['A', 'B'];
const TOKENS_KEPT = 5;
const short = (token: string) => `${token.slice(0, 8)}…`;

export function LockSection({ mode, onResult }: { mode: Mode; onResult: (r: RunResult) => void }) {
  // The lease the pane watches: the name the last operation ran on.
  const [name, setName] = useState('report:nightly');
  const lease = useLease(mode, name);
  // Tokens this browser was handed, per mode and lane, newest first; and each lane's `using` still running.
  const [tokens, setTokens] = useState(() => perMode<Record<Lane, string[]>>(() => ({ A: [], B: [] })));
  // Per lane: how many `using` calls are open, and when the longest one's work ends.
  const [working, setWorking] = useState(() => perMode<Record<Lane, { open: number; until: number }>>(() => ({ A: { open: 0, until: 0 }, B: { open: 0, until: 0 } })));
  const lanes = tokens[mode];
  const now = useNow();
  const workLeft = (lane: Lane) => (working[mode][lane].open ? Math.max(0, working[mode][lane].until - now) : 0);

  const held = lease?.token ?? null;
  // A `using` lane learns its token only when the work ends: until then, a lease no lane knows is that lane's.
  const holder = LANES.find((l) => held && lanes[l].includes(held))
    ?? (held ? LANES.find((l) => working[mode][l].open > 0) : undefined);

  // The bar's full width: the longest TTL seen for the current token (an extend can lengthen it).
  const [full, setFull] = useState<{ token: string | null; ms: number }>({ token: null, ms: 0 });
  const left = lease?.ttlMs ?? 0;
  const token = lease?.token ?? null;
  const scale = token === full.token ? Math.max(full.ms, left) : left;
  if (token !== full.token || scale !== full.ms) setFull({ token, ms: scale });

  const tokenOf = (v: string) => (v === '$A' ? lanes.A[0] ?? '' : v === '$B' ? lanes.B[0] ?? '' : v);
  const keep = (lane: Lane, token: unknown) => {
    if (typeof token !== 'string') return;
    setTokens((t) => ({ ...t, [mode]: { ...t[mode], [lane]: [token, ...t[mode][lane].filter((x) => x !== token)].slice(0, TOKENS_KEPT) } }));
  };
  const run = async (op: string, v: Values) => {
    const lane = v.lane as Lane;
    const at = mode;
    setName(String(v.name));
    const work = (delta: 1 | -1) => setWorking((w) => {
      const { open, until } = w[at][lane];
      return { ...w, [at]: { ...w[at], [lane]: { open: open + delta, until: delta > 0 ? Math.max(until, Date.now() + Number(v.work) * 1000) : until } } };
    });
    if (op === 'using') work(1);
    try {
      const r = await runOperation(at, 'lock', op, () => spec('lock', op).body!({ ...v, token: tokenOf(String(v.token ?? '')) }));
      if (r.httpStatus === 200) keep(lane, (r.body as { token?: unknown } | null)?.token);
      return r;
    } finally {
      if (op === 'using') work(-1);
    }
  };
  const options = [
    { value: '$A', label: `A's last token${lanes.A[0] ? ` (${short(lanes.A[0])})` : ' (none)'}` },
    { value: '$B', label: `B's last token${lanes.B[0] ? ` (${short(lanes.B[0])})` : ' (none)'}` },
    ...LANES.flatMap((l) => lanes[l].slice(1).map((t) => ({ value: t, label: `${l} · ${short(t)}` }))),
  ];
  return (
    <div className="space-y-4">
      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm"><Lock className="size-4" /> {lease?.key ?? `showcase:lock:${name}`}</CardTitle>
          <CardDescription>One lease, two holders. The bar is the key&apos;s remaining TTL and the holder its stored token, read from Redis (native GET + PTTL, not a package call).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="h-3 overflow-hidden rounded-full bg-muted">
            <div className={cn('h-full transition-[width] duration-200 ease-linear', held ? 'bg-mode-standalone' : 'bg-transparent')}
              style={{ width: `${held && scale ? Math.min(100, (left / scale) * 100) : 0}%` }} />
          </div>
          <div className="font-mono text-xs text-muted-foreground">
            {!lease ? 'reading…' : held ? (
              <>held by <span className="font-medium text-foreground">{holder ?? 'another client'}</span> · {(left / 1000).toFixed(1)}s left · token {short(held)}
                {holder && working[mode][holder].open > 0 && <> · working {(workLeft(holder) / 1000).toFixed(1)}s</>}</>
            ) : 'free'}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {LANES.map((lane) => {
              const holds = holder === lane;
              return (
                <div key={lane} className={cn('space-y-2 rounded-lg border p-3', holds && 'border-success ring-1 ring-success')}>
                  <div className="flex items-center justify-between text-sm font-medium">Holder {lane} {holds ? <Badge className="bg-success text-success-foreground">holds</Badge> : <Badge variant="outline">waiting</Badge>}</div>
                  <ul className="space-y-0.5 font-mono text-[11px] text-muted-foreground">
                    {lanes[lane].map((t, i) => <li key={t} className={cn(i === 0 && 'text-foreground')}>{short(t)}{held === t && ' ← lease'}</li>)}
                    {working[mode][lane].open > 0 && <li className="text-warning">using() working, {(workLeft(lane) / 1000).toFixed(1)}s left</li>}
                    {!lanes[lane].length && !working[mode][lane].open && <li>no tokens yet</li>}
                  </ul>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
      <OpForm module="lock" ops={['acquire', 'extend', 'release', 'using']} mode={mode} tokens={options} onRun={run} onResult={onResult} />
    </div>
  );
}
