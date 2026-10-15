// The failover section (sentinel only): the failover drill with its examples, a topology card showing what Sentinel
// says next to what each node says about itself, a filterable drill log, and what survived. Everything comes from the
// sentinel stack: the status stream for the topology, the drill's own stream for the rest.
'use client';

import type { DrillCheck, DrillEvent, FailoverKind, SentinelStatus } from '@showcase/contracts';
import { AlertTriangle, CheckCircle2, CircleHelp, Eye, Loader2, Play, Server, XCircle, Zap } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import type { RunResult } from '@/lib/showcase/api';
import { spec, type Values } from '@/lib/showcase/examples';
import { nodeViews, useFailoverDrill, type DrillEventKind, type NodeView } from '@/lib/showcase/failover-drill';
import { RequestForm } from './request-form';

type Drill = ReturnType<typeof useFailoverDrill>;
const KINDS: DrillEventKind[] = ['setup', 'trigger', 'sentinel', 'call', 'onError'];
const sec = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

function Readiness({ sentinel }: { sentinel: SentinelStatus | null }) {
  if (!sentinel) return <Badge variant="outline">status unknown</Badge>;
  return sentinel.failoverReady
    ? <Badge className="bg-success text-success-foreground">failover ready</Badge>
    : <Badge className="bg-warning text-warning-foreground">replica resyncing</Badge>;
}

function Controls({ d, sentinel }: { d: Drill; sentinel: SentinelStatus | null }) {
  const s = spec('failover', 'drill');
  const [exampleId, setExampleId] = useState<string | null>(s.examples[0].id);
  const [values, setValues] = useState<Values>(s.examples[0].values);
  const example = s.examples.find((e) => e.id === exampleId);
  const modified = !example || JSON.stringify(values) !== JSON.stringify(example.values);
  const kind = values.kind as FailoverKind, pauseMs = Number(values.pauseMs) || undefined;
  // The backend has the last word (it answers 409); the buttons only follow the status it streams.
  const ready = !!sentinel?.failoverReady;
  const busy = d.running || d.sending;
  return (
    <RequestForm spec={s} values={values} modified={modified} onChange={setValues}
      selected={modified ? null : exampleId} onPick={(e) => { setExampleId(e.id); setValues(e.values); }}
      onReset={() => example && setValues(example.values)}
      footer={<>
        <Button onClick={() => d.drill(kind, pauseMs)} disabled={!ready || busy}>{d.running ? <Loader2 className="animate-spin" /> : <Play />} Run drill</Button>
        <Button variant="outline" onClick={() => d.failOver(kind, pauseMs)} disabled={!ready || busy}><Zap /> Fail over only</Button>
        {!ready && <span className="text-xs text-muted-foreground">Disabled until the replica is back in sync (409 FAILOVER_NOT_READY).</span>}
        {d.refusal && <span className="text-xs text-destructive">{d.refusal}</span>}
        <span className="ml-auto"><Readiness sentinel={sentinel} /></span>
      </>} />
  );
}

function NodeBox({ v }: { v: NodeView }) {
  const twoMasters = v.own === 'master' && v.sentinel !== 'master';
  return (
    <div className={cn('rounded-lg border p-3', v.sentinel === 'master' && 'border-mode-sentinel ring-1 ring-mode-sentinel', twoMasters && 'border-warning ring-2 ring-warning')}>
      <div className="flex items-center gap-2 font-mono text-sm font-medium"><Server className="size-4" /> {v.address}</div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-muted-foreground">Sentinel says</dt><dd className="font-mono">{v.sentinel}</dd>
        <dt className="text-muted-foreground">Node says (ROLE)</dt>
        <dd className={cn('font-mono', v.own === null && 'text-destructive')} title={v.error}>{v.own ?? 'no answer'}</dd>
        {v.link && <><dt className="text-muted-foreground">replication link</dt><dd className="font-mono">{v.link}</dd></>}
      </dl>
      {twoMasters && <p className="mt-2 flex items-center gap-1 text-xs text-warning"><AlertTriangle className="size-3.5" /> still thinks it is master: writes it accepts now can be lost</p>}
    </div>
  );
}

function ChecksList({ checks }: { checks: DrillCheck[] }) {
  const icon = (o: DrillCheck['outcome']) => o === 'kept' ? <CheckCircle2 className="size-4 text-success" /> : o === 'lost' ? <XCircle className="size-4 text-destructive" /> : <CircleHelp className="size-4 text-muted-foreground" />;
  return (
    <ul className="space-y-2 text-sm">
      {checks.map((c) => <li key={c.label} className="flex gap-2">{icon(c.outcome)}<div><div className="font-medium">{c.label}: {c.outcome}</div><div className="text-xs text-muted-foreground">{c.detail}</div></div></li>)}
    </ul>
  );
}

const KIND_STYLE: Record<DrillEvent['kind'], string> = {
  setup: 'text-muted-foreground', trigger: 'text-mode-sentinel font-medium', call: 'text-foreground', sentinel: 'text-code-key',
  onError: 'text-destructive', failed: 'text-destructive font-medium', end: 'text-muted-foreground',
};

function eventText(e: DrillEvent) {
  switch (e.kind) {
    case 'setup': case 'trigger': return e.text;
    case 'sentinel': return `${e.channel} ${e.message}`;
    case 'call': return `${e.op}() → ${e.node ?? '?'} · ${e.latencyMs}ms${e.stale ? ' · old master' : ''}${e.error ? ` · ${e.error}` : ''}`;
    case 'onError': return `${e.source}: ${e.message}`;
    case 'failed': return e.message;
    case 'end': return 'drill over';
  }
}

function EventLine({ e }: { e: DrillEvent }) {
  const flagged = e.kind === 'call' && (e.stale || !e.ok || e.latencyMs > 100);
  return (
    <li className="flex gap-3 py-0.5 font-mono text-xs">
      <span className="w-12 shrink-0 text-right text-muted-foreground">{sec(e.t)}</span>
      <span className="w-16 shrink-0 text-muted-foreground">{e.kind}</span>
      <span className={cn(KIND_STYLE[e.kind], flagged && (e.kind === 'call' && !e.ok ? 'text-destructive' : 'text-warning'))}>{eventText(e)}</span>
    </li>
  );
}

export function FailoverSection({ sentinel, onResult }: { sentinel: SentinelStatus | null; onResult: (r: RunResult) => void }) {
  const d = useFailoverDrill(onResult);
  const [show, setShow] = useState<string[]>(KINDS);
  const events = d.run?.events ?? [];
  const shown = events.filter((e) => e.kind === 'failed' || show.includes(e.kind));
  const end = events.find((e) => e.kind === 'end');
  const nodes = nodeViews(sentinel);
  return (
    <div className="space-y-4">
      <Controls d={d} sentinel={sentinel} />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Eye className="size-4" /> Topology</CardTitle>
          <CardDescription>Three sentinels (quorum 2) watch mymaster. Each node shows what Sentinel says next to what the node says about itself, checked every 2 s and on each +switch-master.</CardDescription>
          <CardAction><Readiness sentinel={sentinel} /></CardAction>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {(sentinel?.sentinels ?? []).map((s) => (
              <Badge key={s.address} variant="outline" className={cn('font-mono', !s.quorumOk && 'border-destructive text-destructive')} title={s.error ?? s.quorum}><Eye /> sentinel {s.address.split(':').pop()}</Badge>
            ))}
          </div>
          <div className="grid gap-3 @3xl:grid-cols-2">{nodes.map((v) => <NodeBox key={v.address} v={v} />)}</div>
          {!sentinel && <p className="text-sm text-muted-foreground">Waiting for the sentinel status from the backend.</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Drill log {d.run && <span className="font-mono text-sm font-normal text-muted-foreground">· {d.run.kind} · {sec(events.at(-1)?.t ?? 0)}{d.running && ' · running'}</span>}</CardTitle>
          <CardDescription>{d.stats.calls} calls · {d.stats.failed} failed · worst {d.stats.worstMs.toFixed(0)} ms · {d.stats.onError} onError · {d.stats.staleWrites} writes to the old master</CardDescription>
          <CardAction>
            <ToggleGroup type="multiple" variant="outline" size="sm" value={show} onValueChange={setShow}>
              {KINDS.map((k) => <ToggleGroupItem key={k} value={k} className="font-mono text-xs">{k}</ToggleGroupItem>)}
            </ToggleGroup>
          </CardAction>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-72"><ul>{shown.map((e, i) => <EventLine key={i} e={e} />).reverse()}</ul></ScrollArea>
          {!d.run && <p className="text-sm text-muted-foreground">Run a drill to see every call, Sentinel announcement and onError event as it happens.</p>}
        </CardContent>
      </Card>
      {end && end.checks.length > 0 && (
        <Card><CardHeader><CardTitle>What survived</CardTitle></CardHeader><CardContent><ChecksList checks={end.checks} /></CardContent></Card>
      )}
      <p className="text-xs text-muted-foreground">
        The failover is sent by the showcase, not the package: the package has no failover command. The workload runs on the sentinel mode client, so its onError events also reach the event log below.
      </p>
    </div>
  );
}
