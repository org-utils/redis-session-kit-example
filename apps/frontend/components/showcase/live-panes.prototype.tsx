// PROTOTYPE (throwaway): three variants of the live panes for lock, rate-limit, pub/sub and streams, via ?variant=A|B|C.
// A: form + side pane. B: pane first, form below. C: direct (the pane is the control; examples as one-click chips).
'use client';

import { Gauge, Lock, Play, Plus, Radio, RotateCcw, Timer, Waves, X, Zap } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type { Example, OpSpec, Values } from '@/lib/showcase/examples';
import {
  RL, SPECS, useLockSim, usePubSubSim, useRateSim, useStreamSim, type Lane,
} from '@/lib/showcase/live-panes.prototype';
import type { Mode } from '@/lib/showcase/mock-backend';
import { RequestForm, type TokenOption } from './request-form';
import { Json } from './result-display';

type Sims = { lock: ReturnType<typeof useLockSim>; rate: ReturnType<typeof useRateSim>; pubsub: ReturnType<typeof usePubSubSim>; streams: ReturnType<typeof useStreamSim> };
const s1 = (ms: number) => `${Math.max(0, ms / 1000).toFixed(1)}s`;
const parse = (s: unknown) => { try { return JSON.parse(String(s)); } catch { return {}; } };

/* ───────────── dispatch: run an operation against the simulators ───────────── */
function run(module: string, op: string, v: Values, s: Sims): unknown {
  const n = (x: unknown) => Number(x);
  if (module === 'lock') {
    const lane = v.lane as Lane;
    const token = String(v.token) === '$A' ? s.lock.tokens.A[0] ?? '' : String(v.token) === '$B' ? s.lock.tokens.B[0] ?? '' : String(v.token);
    if (op === 'acquire') return s.lock.acquire(lane, String(v.name), n(v.ttl)).body;
    if (op === 'extend') return s.lock.extend(lane, token, n(v.ttl)).body;
    if (op === 'release') return s.lock.release(lane, token).body;
    if (op === 'using') return s.lock.using(lane, 'report:nightly', n(v.work), n(v.ttl)).body;
  }
  if (module === 'rate-limit') {
    if (op === 'consume') return s.rate.consume(String(v.subject), n(v.cost));
    if (op === 'check') return s.rate.check();
    if (op === 'reset') return s.rate.reset();
    if (op === 'burst') { s.rate.burst(String(v.subject), n(v.n)); return { sent: n(v.n), note: 'watch the bar' }; }
  }
  if (module === 'pubsub') {
    if (op === 'subscribe') { s.pubsub.subscribe(String(v.channel)); return { subscribed: v.channel }; }
    if (op === 'publish') { const p = s.pubsub.publish(String(v.channel), String(v.message)); return p.returned; }
  }
  if (module === 'streams') {
    if (op === 'createGroup') return s.streams.createGroup(String(v.group), v.start as '$' | '0');
    if (op === 'add') return s.streams.add(parse(v.fields));
    if (op === 'read') return s.streams.readGroup(String(v.group), String(v.consumer), n(v.count), v.pending === true);
    if (op === 'ack') {
      const ids = String(v.ids) === '$last' ? Object.values(s.streams.read).flat().slice(-2) : String(v.ids).split(',').map((x) => x.trim());
      return s.streams.ack(String(v.group), ids);
    }
  }
  return null;
}

function tokenOptions(module: string, s: Sims): TokenOption[] | undefined {
  if (module === 'lock') return [
    { value: '$A', label: `A's last token${s.lock.tokens.A[0] ? ` (${s.lock.tokens.A[0]})` : ' (none)'}` },
    { value: '$B', label: `B's last token${s.lock.tokens.B[0] ? ` (${s.lock.tokens.B[0]})` : ' (none)'}` },
    ...(['A', 'B'] as Lane[]).flatMap((l) => s.lock.tokens[l].slice(1).map((t) => ({ value: t, label: `${l} · ${t}` }))),
  ];
  if (module === 'streams') return [
    { value: '$last', label: 'the last ids I read' },
    ...Object.entries(s.streams.read).flatMap(([c, ids]) => ids.map((id) => ({ value: id, label: `${c} · ${id}` }))),
  ];
  return undefined;
}

/* ───────────── panes ───────────── */
function LockPane({ s, interactive }: { s: Sims; interactive?: boolean }) {
  const { lease, now } = s.lock;
  const left = lease ? lease.expiresAt - now : 0;
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm"><Lock className="size-4" /> showcase:lock:report:nightly</CardTitle>
        <CardDescription>One lease, two holders. The bar is the key&apos;s remaining TTL.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="h-3 overflow-hidden rounded-full bg-muted">
          <div className={cn('h-full transition-[width] duration-100', lease ? 'bg-mode-standalone' : 'bg-transparent')} style={{ width: `${lease ? Math.min(100, (left / 30000) * 100) : 0}%` }} />
        </div>
        <div className="font-mono text-xs text-muted-foreground">{lease ? <>held by <span className="font-medium text-foreground">{lease.lane}</span> · {s1(left)} left · token {lease.token}{lease.using && lease.using > now && <> · working {s1(lease.using - now)}</>}</> : 'free'}</div>
        <div className="grid grid-cols-2 gap-3">
          {(['A', 'B'] as Lane[]).map((lane) => {
            const holds = lease?.lane === lane;
            return (
              <div key={lane} className={cn('space-y-2 rounded-lg border p-3', holds && 'border-success ring-1 ring-success')}>
                <div className="flex items-center justify-between text-sm font-medium">Holder {lane} {holds ? <Badge className="bg-success text-success-foreground">holds</Badge> : <Badge variant="outline">waiting</Badge>}</div>
                <ul className="space-y-0.5 font-mono text-[11px] text-muted-foreground">{s.lock.tokens[lane].map((t, i) => <li key={t} className={cn(i === 0 && 'text-foreground')}>{t}{lease?.token === t && ' ← lease'}</li>)}{!s.lock.tokens[lane].length && <li>no tokens yet</li>}</ul>
                {interactive && (
                  <div className="flex flex-wrap gap-1">
                    <Button size="xs" onClick={() => s.lock.acquire(lane, 'report:nightly', 30)}>acquire 30s</Button>
                    <Button size="xs" variant="outline" onClick={() => s.lock.extend(lane, s.lock.tokens[lane][0] ?? '', 30)}>extend</Button>
                    <Button size="xs" variant="outline" onClick={() => s.lock.release(lane, s.lock.tokens[lane][0] ?? '')}>release</Button>
                    <Button size="xs" variant="outline" onClick={() => s.lock.using(lane, 'report:nightly', 10, 30)}>using 10s</Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {interactive && <ul className="space-y-0.5 font-mono text-[11px]">{s.lock.log.slice(0, 5).map((r, i) => <li key={i}><span className="text-muted-foreground">{r.lane}</span> {r.call} → <span className="text-code-key">{JSON.stringify(r.body)}</span></li>)}</ul>}
      </CardContent>
    </Card>
  );
}

function RatePane({ s, interactive }: { s: Sims; interactive?: boolean }) {
  const { win, now, log } = s.rate;
  const count = win?.count ?? 0;
  const resetIn = win ? win.start + RL.windowS * 1000 - now : 0;
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm"><Gauge className="size-4" /> showcase:rate-limit:{'{user:42}'}</CardTitle>
        <CardDescription>{RL.limit} requests per {RL.windowS} s window.</CardDescription>
        <CardAction><Badge variant="outline" className="font-mono"><Timer /> {win ? `resets in ${s1(resetIn)}` : 'no window'}</Badge></CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-1">{Array.from({ length: RL.limit }, (_, i) => <div key={i} className={cn('h-6 flex-1 rounded-sm', i < count ? (count >= RL.limit ? 'bg-destructive' : 'bg-mode-standalone') : 'bg-muted')} />)}</div>
        <div className="font-mono text-xs text-muted-foreground">count {count} / {RL.limit} · remaining {Math.max(0, RL.limit - count)}</div>
        <div className="flex flex-wrap gap-1">
          {log.slice(0, 30).reverse().map((e) => {
            const r = e.r as { allowed?: boolean; retryAfterSeconds?: number; error?: unknown };
            return <span key={e.id} title={JSON.stringify(e.r)} className={cn('flex h-5 min-w-5 items-center justify-center rounded px-1 font-mono text-[10px]', e.op === 'reset' || r.error ? 'bg-muted' : r.allowed ? 'bg-success text-success-foreground' : 'bg-destructive text-background')}>{e.op === 'reset' ? '↺' : e.op === 'check' ? 'c' : r.error ? '·' : r.allowed ? e.cost : `${r.retryAfterSeconds}s`}</span>;
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">Green: allowed (cost). Red: denied (retryAfterSeconds). c: check. ↺: reset.</p>
        {interactive && (
          <div className="flex flex-wrap gap-1">
            <Button size="xs" onClick={() => s.rate.consume('user:42', 1)}>consume 1</Button>
            <Button size="xs" variant="outline" onClick={() => s.rate.consume('user:42', 4)}>consume 4</Button>
            <Button size="xs" variant="outline" onClick={() => s.rate.check()}>check</Button>
            <Button size="xs" variant="outline" onClick={() => s.rate.reset()}><RotateCcw /> reset</Button>
            <Button size="xs" variant="secondary" onClick={() => s.rate.burst('user:42', 15)}><Zap /> burst 15</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PubSubPane({ s, interactive }: { s: Sims; interactive?: boolean }) {
  const [channel, setChannel] = useState('orders.created');
  const [msg, setMsg] = useState('{ "orderId": "42" }');
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm"><Radio className="size-4" /> Subscriptions</CardTitle>
        <CardDescription>One card per subscribe. Cards on the same channel share one Redis SUBSCRIBE.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {interactive && (
          <div className="flex flex-wrap gap-2">
            <Input value={channel} onChange={(e) => setChannel(e.target.value)} className="h-7 w-44 font-mono text-xs" />
            <Button size="xs" onClick={() => s.pubsub.subscribe(channel)}><Plus /> subscribe</Button>
            <Input value={msg} onChange={(e) => setMsg(e.target.value)} className="h-7 w-52 font-mono text-xs" />
            <Button size="xs" variant="secondary" onClick={() => s.pubsub.publish(channel, msg)}><Play /> publish</Button>
          </div>
        )}
        <div className="grid gap-2 @3xl:grid-cols-2">
          {s.pubsub.cards.map((c) => (
            <div key={c.id} className="rounded-lg border p-2">
              <div className="flex items-center justify-between font-mono text-xs"><span className="text-code-key">{c.channel}</span><Button size="icon-xs" variant="ghost" onClick={() => s.pubsub.unsubscribe(c.id)} aria-label="Unsubscribe"><X /></Button></div>
              <ul className="mt-1 space-y-0.5 font-mono text-[11px]">{c.messages.map((m) => <li key={m.seq}><span className="text-muted-foreground">#{m.seq}</span> {m.value}</li>)}{!c.messages.length && <li className="text-muted-foreground">waiting…</li>}</ul>
            </div>
          ))}
          {!s.pubsub.cards.length && <p className="text-xs text-muted-foreground">No subscriptions. Subscribe to open a card.</p>}
        </div>
        {s.pubsub.pubs.length > 0 && (
          <Table className="text-xs">
            <TableHeader><TableRow><TableHead>publish</TableHead><TableHead>returned</TableHead><TableHead>cards received</TableHead></TableRow></TableHeader>
            <TableBody>{s.pubsub.pubs.slice(0, 5).map((p) => (
              <TableRow key={p.id}><TableCell className="font-mono">{p.channel}</TableCell><TableCell className="font-mono">{p.returned}</TableCell>
                <TableCell className={cn('font-mono', p.returned !== p.delivered && 'text-warning')}>{p.delivered}{p.returned !== p.delivered && ' ≠ returned'}</TableCell></TableRow>
            ))}</TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function StreamPane({ s, interactive }: { s: Sims; interactive?: boolean }) {
  const { entries, groups } = s.streams;
  const pendingIds = new Set(Object.values(groups).flatMap((g) => Object.values(g.pending).flat()));
  return (
    <div className="grid gap-3 @4xl:grid-cols-2">
      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm"><Waves className="size-4" /> Following orders</CardTitle>
          <CardDescription>A plain read from $: every entry as it is added.</CardDescription>
          {interactive && <CardAction><Button size="xs" onClick={() => s.streams.add({ orderId: String(40 + entries.length), type: 'created' })}><Plus /> add</Button></CardAction>}
        </CardHeader>
        <CardContent>
          <ul className="space-y-0.5 font-mono text-[11px]">{entries.slice(-10).map((e) => <li key={e.id}><span className={cn('text-code-key', pendingIds.has(e.id) && 'text-warning')}>{e.id}</span> {JSON.stringify(e.fields)}</li>)}{!entries.length && <li className="text-muted-foreground">empty stream</li>}</ul>
        </CardContent>
      </Card>
      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">Delivered, not acked</CardTitle>
          <CardDescription>Read with native XPENDING: not part of the package.</CardDescription>
          {interactive && <CardAction><Button size="xs" variant="outline" onClick={() => s.streams.createGroup('billing', '$')}>create billing</Button></CardAction>}
        </CardHeader>
        <CardContent className="space-y-2">
          {Object.values(groups).map((g) => (
            <div key={g.name}>
              <div className="font-mono text-xs font-medium">{g.name}</div>
              <Table className="text-xs">
                <TableBody>
                  {['worker-1', 'worker-2'].map((c) => (
                    <TableRow key={c}>
                      <TableCell className="w-20 font-mono">{c}</TableCell>
                      <TableCell className="font-mono text-warning">{(g.pending[c] ?? []).join(', ') || <span className="text-muted-foreground">—</span>}</TableCell>
                      {interactive && (
                        <TableCell className="w-40 text-right">
                          <Button size="xs" variant="outline" onClick={() => s.streams.readGroup(g.name, c, 2, false)}>read</Button>{' '}
                          <Button size="xs" variant="outline" onClick={() => s.streams.ack(g.name, g.pending[c] ?? [])} disabled={!(g.pending[c] ?? []).length}>ack</Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ))}
          {!Object.keys(groups).length && <p className="text-xs text-muted-foreground">No groups yet. Create one to see pending entries per consumer.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function Pane({ module, s, interactive }: { module: string; s: Sims; interactive?: boolean }) {
  if (module === 'lock') return <LockPane s={s} interactive={interactive} />;
  if (module === 'rate-limit') return <RatePane s={s} interactive={interactive} />;
  if (module === 'pubsub') return <PubSubPane s={s} interactive={interactive} />;
  return <StreamPane s={s} interactive={interactive} />;
}

/* ───────────── the form, for variants A and B ───────────── */
function useForm(module: string) {
  const ops = SPECS[module];
  const [op, setOp] = useState(Object.keys(ops)[0]);
  const spec: OpSpec = ops[op] ?? Object.values(ops)[0];
  const [exampleId, setExampleId] = useState<string | null>(spec.examples[0].id);
  const [values, setValues] = useState<Values>(spec.examples[0].values);
  const example = spec.examples.find((e) => e.id === exampleId);
  const modified = !example || JSON.stringify(values) !== JSON.stringify(example.values);
  const pickOp = (o: string) => { setOp(o); setExampleId(ops[o].examples[0].id); setValues(ops[o].examples[0].values); };
  return { ops, op: ops[op] ? op : Object.keys(ops)[0], spec, exampleId, setExampleId, values, setValues, example, modified, pickOp };
}

function FormBlock({ module, s, compact }: { module: string; s: Sims; compact?: boolean }) {
  const f = useForm(module);
  const [result, setResult] = useState<unknown>(undefined);
  return (
    <div className="space-y-3">
      <Tabs value={f.op} onValueChange={(o) => { f.pickOp(o); setResult(undefined); }}>
        <TabsList variant="line">{Object.keys(f.ops).map((o) => <TabsTrigger key={o} value={o} className="font-mono">{o}</TabsTrigger>)}</TabsList>
      </Tabs>
      <RequestForm spec={f.spec} values={f.values} modified={f.modified} onChange={f.setValues} tokens={tokenOptions(module, s)}
        selected={f.modified ? null : f.exampleId} onPick={(e) => { f.setExampleId(e.id); f.setValues(e.values); }}
        onReset={() => f.example && f.setValues(f.example.values)}
        footer={<Button onClick={() => setResult(run(module, f.op, f.values, s))}><Play /> Run</Button>} />
      {result !== undefined && !compact && <Card size="sm"><CardHeader><CardTitle className="font-mono text-sm">{f.op}()</CardTitle></CardHeader><CardContent><Json value={result} /></CardContent></Card>}
      {result !== undefined && compact && <Json value={result} />}
    </div>
  );
}

/* ───────────── variants ───────────── */
function VariantA({ module, s }: { module: string; s: Sims }) {
  return (
    <div className="grid grid-cols-1 gap-4 @5xl:grid-cols-[minmax(0,1fr)_26rem]">
      <FormBlock module={module} s={s} />
      <div className="space-y-2"><div className="text-xs font-medium uppercase text-muted-foreground">Live</div><Pane module={module} s={s} /></div>
    </div>
  );
}

function VariantB({ module, s }: { module: string; s: Sims }) {
  return (
    <div className="space-y-4">
      <Pane module={module} s={s} />
      <FormBlock module={module} s={s} compact />
    </div>
  );
}

function VariantC({ module, s }: { module: string; s: Sims }) {
  const [last, setLast] = useState<{ call: string; result: unknown } | null>(null);
  const chips: { op: string; ex: Example }[] = Object.entries(SPECS[module]).flatMap(([op, spec]) => spec.examples.map((ex) => ({ op, ex })));
  const fire = (op: string, ex: Example) => setLast({ call: SPECS[module][op].call(ex.values), result: run(module, op, ex.values, s) });
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <div className="text-xs font-medium uppercase text-muted-foreground">Try this</div>
        <div className="flex flex-wrap gap-1.5">
          {chips.map(({ op, ex }) => <Button key={`${op}.${ex.id}`} size="sm" variant="outline" title={ex.description} onClick={() => fire(op, ex)}><span className="font-mono text-muted-foreground">{op}</span> {ex.title}</Button>)}
        </div>
      </div>
      <Pane module={module} s={s} interactive />
      {last && (
        <div className="space-y-1">
          <pre className="overflow-x-auto rounded-md bg-code p-2 font-mono text-xs text-code-foreground">{last.call}</pre>
          <Json value={last.result} />
        </div>
      )}
    </div>
  );
}

export const LIVE_MODULES = ['lock', 'rate-limit', 'pubsub', 'streams'];
export const LIVE_VARIANTS = [{ key: 'A', name: 'Form + side pane' }, { key: 'B', name: 'Pane first' }, { key: 'C', name: 'Direct' }];

export function LivePanesPrototype({ module, mode, variant }: { module: string; mode: Mode; variant: string }): ReactNode {
  const s: Sims = { lock: useLockSim(), rate: useRateSim(), pubsub: usePubSubSim(mode), streams: useStreamSim() };
  const V = variant === 'B' ? VariantB : variant === 'C' ? VariantC : VariantA;
  return <V key={module} module={module} s={s} />;
}
