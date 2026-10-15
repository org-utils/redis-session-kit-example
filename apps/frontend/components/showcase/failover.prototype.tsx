// PROTOTYPE (throwaway): three variants of the failover section, switchable via ?variant=A|B|C.
// A: topology + event log. B: swimlane timeline. C: before / during / after report. All data is stubbed.
'use client';

import { AlertTriangle, ArrowRight, CheckCircle2, CircleHelp, Eye, Play, Server, XCircle, Zap } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import type { Values } from '@/lib/showcase/examples';
import {
  DRILL_SPEC, WINDOW_MS, nodesAt, useFailoverDrill, type Check, type DrillEvent, type DrillKind, type EventKind, type NodeView, type Port,
} from '@/lib/showcase/failover-drill.prototype';
import { RequestForm } from './request-form';

type Drill = ReturnType<typeof useFailoverDrill>;
const PORTS: Port[] = ['6380', '6381'];
const sec = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

function useDrillForm() {
  const [exampleId, setExampleId] = useState<string | null>('graceful');
  const [values, setValues] = useState<Values>(DRILL_SPEC.examples[0].values);
  const example = DRILL_SPEC.examples.find((e) => e.id === exampleId);
  const modified = !example || JSON.stringify(values) !== JSON.stringify(example.values);
  return { exampleId, setExampleId, values, setValues, example, modified };
}

function Readiness({ d }: { d: Drill }) {
  return d.ready
    ? <Badge className="bg-success text-success-foreground">failover ready</Badge>
    : <Badge className="bg-warning text-warning-foreground">replica resyncing · ready in {Math.ceil(d.readyInMs / 1000)}s</Badge>;
}

function Buttons({ d, kind, pauseMs }: { d: Drill; kind: DrillKind; pauseMs: number }) {
  return (
    <>
      <Button onClick={() => d.start(kind, true, pauseMs)} disabled={!d.ready || d.running}><Play /> Run drill</Button>
      <Button variant="outline" onClick={() => d.start(kind, false, pauseMs)} disabled={!d.ready || d.running}><Zap /> Fail over only</Button>
      {!d.ready && <span className="text-xs text-muted-foreground">Disabled until the replica is back in sync (409 FAILOVER_NOT_READY).</span>}
      {d.refusal && <span className="text-xs text-destructive">{d.refusal}</span>}
    </>
  );
}

function Controls({ d }: { d: Drill }) {
  const f = useDrillForm();
  return (
    <RequestForm spec={DRILL_SPEC} values={f.values} modified={f.modified} onChange={f.setValues}
      selected={f.modified ? null : f.exampleId} onPick={(e) => { f.setExampleId(e.id); f.setValues(e.values); }}
      onReset={() => f.example && f.setValues(f.example.values)}
      footer={<><Buttons d={d} kind={f.values.kind as DrillKind} pauseMs={Number(f.values.pauseMs) || 8000} /><span className="ml-auto"><Readiness d={d} /></span></>} />
  );
}

function NodeBox({ port, v }: { port: Port; v: NodeView }) {
  const twoMasters = v.own === 'master' && v.sentinel !== 'master';
  return (
    <div className={cn('rounded-lg border p-3', v.sentinel === 'master' && 'border-mode-sentinel ring-1 ring-mode-sentinel', twoMasters && 'border-warning ring-2 ring-warning')}>
      <div className="flex items-center gap-2 font-mono text-sm font-medium"><Server className="size-4" /> 127.0.0.1:{port}</div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-muted-foreground">Sentinel says</dt><dd className="font-mono">{v.sentinel}</dd>
        <dt className="text-muted-foreground">Node says (ROLE)</dt><dd className={cn('font-mono', v.own === 'paused' && 'text-destructive')}>{v.own === 'paused' ? 'no answer (paused)' : v.own}</dd>
        {v.link && <><dt className="text-muted-foreground">replication link</dt><dd className="font-mono">{v.link}</dd></>}
      </dl>
      {twoMasters && <p className="mt-2 flex items-center gap-1 text-xs text-warning"><AlertTriangle className="size-3.5" /> still thinks it is master: writes it accepts now will be lost</p>}
    </div>
  );
}

function ChecksList({ checks }: { checks: Check[] }) {
  const icon = (o: Check['outcome']) => o === 'kept' ? <CheckCircle2 className="size-4 text-success" /> : o === 'lost' ? <XCircle className="size-4 text-destructive" /> : <CircleHelp className="size-4 text-muted-foreground" />;
  return (
    <ul className="space-y-2 text-sm">
      {checks.map((c) => <li key={c.label} className="flex gap-2">{icon(c.outcome)}<div><div className="font-medium">{c.label}: {c.outcome}</div><div className="text-xs text-muted-foreground">{c.detail}</div></div></li>)}
    </ul>
  );
}

const KIND_STYLE: Record<EventKind, string> = {
  setup: 'text-muted-foreground', trigger: 'text-mode-sentinel font-medium', call: 'text-foreground', sentinel: 'text-code-key', onError: 'text-destructive', check: '',
};
function EventLine({ e }: { e: DrillEvent }) {
  return (
    <li className="flex gap-3 py-0.5 font-mono text-xs">
      <span className="w-12 shrink-0 text-right text-muted-foreground">{sec(e.t)}</span>
      <span className="w-16 shrink-0 text-muted-foreground">{e.kind}</span>
      <span className={cn(KIND_STYLE[e.kind], e.stale && 'text-warning', (e.latencyMs ?? 0) > 100 && 'text-warning')}>
        {e.text}{e.kind === 'call' && <> → {e.node} · {e.latencyMs}ms{e.stale && ' · old master'}</>}
      </span>
    </li>
  );
}

function StubNote() {
  return <p className="text-xs text-muted-foreground">Stubbed drill: timings come from the measured sentinel runs (played 4× faster); module outcomes for “Unresponsive master” are guesses until the real backend runs.</p>;
}

/* ───────────── Variant A: topology + event log ───────────── */
function VariantA({ d }: { d: Drill }) {
  const [show, setShow] = useState<string[]>(['setup', 'trigger', 'sentinel', 'onError', 'call']);
  const events = (d.run?.events ?? []).filter((e) => show.includes(e.kind));
  return (
    <div className="space-y-4">
      <Controls d={d} />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Eye className="size-4" /> Topology</CardTitle>
          <CardDescription>Three sentinels (quorum 2) watch mymaster. Each node shows what Sentinel says next to what the node says about itself.</CardDescription>
          <CardAction><Readiness d={d} /></CardAction>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">{['26379', '26380', '26381'].map((p) => <Badge key={p} variant="outline" className="font-mono"><Eye /> sentinel {p}</Badge>)}</div>
          <div className="grid gap-3 @3xl:grid-cols-2">{PORTS.map((p) => <NodeBox key={p} port={p} v={d.nodes[p]} />)}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Drill log {d.run && <span className="font-mono text-sm font-normal text-muted-foreground">· {sec(d.run.t)}</span>}</CardTitle>
          <CardDescription>{d.stats.calls} calls · {d.stats.failed} failed · worst {d.stats.worstMs.toFixed(0)} ms · {d.stats.onError} onError · {d.stats.staleWrites} writes to the old master</CardDescription>
          <CardAction>
            <ToggleGroup type="multiple" variant="outline" size="sm" value={show} onValueChange={setShow}>
              {['setup', 'trigger', 'sentinel', 'call', 'onError'].map((k) => <ToggleGroupItem key={k} value={k} className="font-mono text-xs">{k}</ToggleGroupItem>)}
            </ToggleGroup>
          </CardAction>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-72"><ul>{events.slice().reverse().map((e) => <EventLine key={e.id} e={e} />)}</ul></ScrollArea>
          {!d.run && <p className="text-sm text-muted-foreground">Run a drill to see every call, Sentinel announcement and onError event as it happens.</p>}
        </CardContent>
      </Card>
      {d.run?.done && d.run.withWorkload && (
        <Card><CardHeader><CardTitle>What survived</CardTitle></CardHeader><CardContent><ChecksList checks={d.run.checks} /></CardContent></Card>
      )}
      <StubNote />
    </div>
  );
}

/* ───────────── Variant B: swimlane timeline ───────────── */
function roleSegments(d: Drill, port: Port, endT: number) {
  const segs: { from: number; to: number; label: string }[] = [];
  for (let t = 0; t <= endT; t += 200) {
    const v = nodesAt(d.script, d.run!.from, t)[port];
    const label = v.own === 'paused' ? 'paused' : v.own === 'master' && v.sentinel !== 'master' ? 'master (stale)' : v.own;
    const last = segs[segs.length - 1];
    if (last && last.label === label) last.to = t; else segs.push({ from: t, to: t, label });
  }
  return segs;
}
const SEG_STYLE: Record<string, string> = {
  master: 'bg-mode-sentinel text-background', replica: 'bg-muted text-muted-foreground', paused: 'bg-destructive/70 text-background', 'master (stale)': 'bg-warning text-warning-foreground',
};

function VariantB({ d }: { d: Drill }) {
  const [kind, setKind] = useState<DrillKind>('graceful');
  const endT = d.script?.endT ?? WINDOW_MS;
  const now = d.run?.t ?? 0;
  const x = (t: number) => `${Math.min(100, (t / endT) * 100)}%`;
  const ev = d.run?.events ?? [];
  const lane = 'relative h-8 rounded-md bg-muted/40';
  return (
    <div className="space-y-4">
      <Card size="sm">
        <CardContent className="flex flex-wrap items-center gap-3">
          <ToggleGroup type="single" variant="outline" value={kind} onValueChange={(v) => v && setKind(v as DrillKind)}>
            <ToggleGroupItem value="graceful">Graceful failover</ToggleGroupItem>
            <ToggleGroupItem value="unresponsive">Unresponsive master</ToggleGroupItem>
          </ToggleGroup>
          <Buttons d={d} kind={kind} pauseMs={8000} />
          <span className="ml-auto"><Readiness d={d} /></span>
        </CardContent>
        <CardContent><pre className="rounded-md bg-code p-2 font-mono text-xs text-code-foreground">{DRILL_SPEC.call({ kind, pauseMs: 8000 })}</pre></CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
          <CardDescription>{d.stats.calls} calls · {d.stats.failed} failed · worst {d.stats.worstMs.toFixed(0)} ms · {d.stats.onError} onError · {d.stats.staleWrites} writes to the old master</CardDescription>
        </CardHeader>
        <CardContent>
          {!d.run ? <p className="text-sm text-muted-foreground">Run a drill: each lane fills in as time passes.</p> : (
            <div className="grid grid-cols-[7rem_1fr] items-center gap-x-3 gap-y-2 text-xs">
              {PORTS.map((p) => (
                <div key={p} className="contents">
                  <span className="font-mono">{p} role</span>
                  <div className={cn(lane, 'overflow-hidden')}>
                    {roleSegments(d, p, Math.min(now, endT)).map((s, i) => (
                      <div key={i} className={cn('absolute inset-y-0 flex items-center overflow-hidden px-1 font-mono text-[10px]', SEG_STYLE[s.label])}
                        style={{ left: x(s.from), width: `calc(${x(s.to - s.from + 200)})` }}>{s.label}</div>
                    ))}
                  </div>
                </div>
              ))}
              <span>Sentinel</span>
              <div className={lane}>
                {ev.filter((e) => e.kind === 'sentinel' || e.kind === 'trigger').map((e) => (
                  <div key={e.id} title={`${sec(e.t)} ${e.text}`} className={cn('absolute inset-y-1 w-0.5', e.kind === 'trigger' ? 'bg-mode-sentinel' : e.text.includes('switch-master') ? 'bg-foreground' : 'bg-code-key')} style={{ left: x(e.t) }} />
                ))}
                {ev.filter((e) => e.text.includes('switch-master')).map((e) => <span key={e.id} className="absolute -top-0.5 ml-1 font-mono text-[10px]" style={{ left: x(e.t) }}>+switch-master</span>)}
              </div>
              <span>Workload</span>
              <div className={cn(lane, 'h-16')}>
                {ev.filter((e) => e.kind === 'call').map((e) => {
                  const y = Math.min(1, Math.log10((e.latencyMs ?? 1) + 1) / 4);
                  return <div key={e.id} title={`${sec(e.t)} ${e.text} ${e.latencyMs}ms → ${e.node}`} className={cn('absolute size-1.5 -translate-x-1/2 rounded-full', !e.ok ? 'bg-destructive' : e.stale ? 'bg-warning' : (e.latencyMs ?? 0) > 100 ? 'bg-destructive' : 'bg-success')} style={{ left: x(e.t), bottom: `${4 + y * 80}%` }} />;
                })}
              </div>
              <span>onError</span>
              <div className={lane}>{ev.filter((e) => e.kind === 'onError').map((e) => <div key={e.id} title={e.text} className="absolute inset-y-1 w-0.5 bg-destructive" style={{ left: x(e.t) }} />)}</div>
              <span />
              <div className="relative h-4 font-mono text-[10px] text-muted-foreground">
                {[0, 0.25, 0.5, 0.75, 1].map((f) => <span key={f} className="absolute -translate-x-1/2" style={{ left: `${f * 100}%` }}>{sec(f * endT)}</span>)}
              </div>
            </div>
          )}
          {d.run && <p className="mt-3 text-xs text-muted-foreground">Dot height = call latency (log scale). Green ok · amber answered by the old master · red slow or failed. Hover any mark for details.</p>}
        </CardContent>
      </Card>
      {d.run?.done && d.run.withWorkload && (
        <div className="flex flex-wrap gap-2">
          {d.run.checks.map((c) => <Badge key={c.label} title={c.detail} variant={c.outcome === 'lost' ? 'destructive' : c.outcome === 'kept' ? 'secondary' : 'outline'}>{c.label}: {c.outcome}</Badge>)}
        </div>
      )}
      <StubNote />
    </div>
  );
}

/* ───────────── Variant C: before / during / after ───────────── */
function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return <div className="rounded-lg border p-3"><div className={cn('font-mono text-2xl font-semibold', tone)}>{value}</div><div className="text-xs text-muted-foreground">{label}</div></div>;
}

function VariantC({ d }: { d: Drill }) {
  const ev = d.run?.events ?? [];
  const keySentinel = ev.filter((e) => e.kind === 'trigger' || (e.kind === 'sentinel' && /sdown|odown|switch-master|convert-to-slave|failover ready/.test(e.text)));
  const twoMasters = PORTS.some((p) => d.nodes[p].own === 'master' && d.nodes[p].sentinel !== 'master');
  const bySource = ev.filter((e) => e.kind === 'onError').reduce<Record<string, number>>((m, e) => { const s = e.text.split(':')[0]; m[s] = (m[s] ?? 0) + 1; return m; }, {});
  const phase = !d.run ? 'before' : d.run.done ? 'after' : 'during';
  const col = (p: string) => cn('min-w-0', phase === p && 'ring-2 ring-ring');
  return (
    <div className="space-y-4">
      <Controls d={d} />
      <div className="grid gap-4 @5xl:grid-cols-3">
        <Card className={col('before')}>
          <CardHeader><CardTitle>Before</CardTitle><CardDescription>What the drill sets up on the sentinel mode client.</CardDescription></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center gap-2 font-mono text-xs">master {d.run?.from ?? d.master} <ArrowRight className="size-3" /> replica {d.run?.to ?? (d.master === '6380' ? '6381' : '6380')} · link ok</div>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {(ev.filter((e) => e.kind === 'setup').length ? ev.filter((e) => e.kind === 'setup').map((e) => e.text) : ['a held lock', 'a session', 'a stream group with a blocked read', 'a subscription']).map((s) => <li key={s}>• {s}</li>)}
            </ul>
          </CardContent>
        </Card>
        <Card className={col('during')}>
          <CardHeader><CardTitle>During {d.run && !d.run.done && <span className="font-mono text-sm font-normal text-muted-foreground">· {sec(d.run.t)}</span>}</CardTitle><CardDescription>cache.set → rateLimiter.consume → sessions.validate → pubsub.publish, every 100 ms.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Stat label="calls" value={d.stats.calls} />
              <Stat label="failed" value={d.stats.failed} tone={d.stats.failed ? 'text-destructive' : undefined} />
              <Stat label="worst latency" value={`${d.stats.worstMs.toFixed(0)}ms`} tone={d.stats.worstMs > 100 ? 'text-warning' : undefined} />
              <Stat label="onError events" value={d.stats.onError} tone={d.stats.onError ? 'text-destructive' : undefined} />
            </div>
            {twoMasters && <p className="flex items-center gap-1 rounded-md bg-warning/15 p-2 text-xs"><AlertTriangle className="size-4 text-warning" /> Two masters right now: {d.stats.staleWrites} writes answered by the old master so far.</p>}
            <ul className="space-y-0.5 font-mono text-xs">{keySentinel.map((e) => <li key={e.id}><span className="text-muted-foreground">{sec(e.t)}</span> {e.text}</li>)}</ul>
            {Object.keys(bySource).length > 0 && <div className="flex flex-wrap gap-1">{Object.entries(bySource).map(([s, n]) => <Badge key={s} variant="destructive">{s} ×{n}</Badge>)}</div>}
          </CardContent>
        </Card>
        <Card className={col('after')}>
          <CardHeader><CardTitle>After</CardTitle><CardDescription>Checked once the replica is back in sync.</CardDescription><CardAction><Readiness d={d} /></CardAction></CardHeader>
          <CardContent className="space-y-3">
            <div className="font-mono text-xs">master is now 127.0.0.1:{d.master}</div>
            {d.run?.done && d.run.withWorkload ? <ChecksList checks={d.run.checks} /> : <p className="text-xs text-muted-foreground">{d.run && !d.run.withWorkload ? 'Fail over only: nothing to check.' : 'Lock, session, stream group, subscription and writes in the two-master window, checked at the end.'}</p>}
          </CardContent>
        </Card>
      </div>
      {d.run && (
        <Table className="text-xs">
          <TableHeader><TableRow><TableHead>last calls</TableHead><TableHead>node</TableHead><TableHead>latency</TableHead></TableRow></TableHeader>
          <TableBody>{ev.filter((e) => e.kind === 'call').slice(-5).reverse().map((e) => <TableRow key={e.id}><TableCell className="font-mono">{e.text}</TableCell><TableCell className={cn('font-mono', e.stale && 'text-warning')}>{e.node}{e.stale && ' (old master)'}</TableCell><TableCell className="font-mono">{e.latencyMs}ms</TableCell></TableRow>)}</TableBody>
        </Table>
      )}
      <StubNote />
    </div>
  );
}

export const FAILOVER_VARIANTS = [
  { key: 'A', name: 'Topology + log' }, { key: 'B', name: 'Swimlanes' }, { key: 'C', name: 'Before / during / after' },
];

export function FailoverPrototype({ variant }: { variant: string }) {
  const d = useFailoverDrill(); // shared across variants, so flipping keeps the running drill
  return variant === 'B' ? <VariantB d={d} /> : variant === 'C' ? <VariantC d={d} /> : <VariantA d={d} />;
}
