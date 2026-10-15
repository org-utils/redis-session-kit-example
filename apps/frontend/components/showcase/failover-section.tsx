// The failover section (sentinel only): the failover drill with its examples, a topology card showing what Sentinel
// says next to what each node says about itself, a filterable drill log, and what survived.
'use client';

import { AlertTriangle, CheckCircle2, CircleHelp, Eye, Play, Server, XCircle, Zap } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { spec, type Values } from '@/lib/showcase/examples';
import { useFailoverDrill, type Check, type DrillEvent, type DrillKind, type EventKind, type NodeView, type Port } from '@/lib/showcase/failover-drill';
import { RequestForm } from './request-form';

type Drill = ReturnType<typeof useFailoverDrill>;
const PORTS: Port[] = ['6380', '6381'];
const KINDS: EventKind[] = ['setup', 'trigger', 'sentinel', 'call', 'onError'];
const sec = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

function Readiness({ d }: { d: Drill }) {
  return d.ready
    ? <Badge className="bg-success text-success-foreground">failover ready</Badge>
    : <Badge className="bg-warning text-warning-foreground">replica resyncing · ready in {Math.ceil(d.readyInMs / 1000)}s</Badge>;
}

function Controls({ d }: { d: Drill }) {
  const s = spec('failover', 'drill');
  const [exampleId, setExampleId] = useState<string | null>(s.examples[0].id);
  const [values, setValues] = useState<Values>(s.examples[0].values);
  const example = s.examples.find((e) => e.id === exampleId);
  const modified = !example || JSON.stringify(values) !== JSON.stringify(example.values);
  const kind = values.kind as DrillKind, pauseMs = Number(values.pauseMs) || 8000;
  return (
    <RequestForm spec={s} values={values} modified={modified} onChange={setValues}
      selected={modified ? null : exampleId} onPick={(e) => { setExampleId(e.id); setValues(e.values); }}
      onReset={() => example && setValues(example.values)}
      footer={<>
        <Button onClick={() => d.start(kind, true, pauseMs)} disabled={!d.ready || d.running}><Play /> Run drill</Button>
        <Button variant="outline" onClick={() => d.start(kind, false, pauseMs)} disabled={!d.ready || d.running}><Zap /> Fail over only</Button>
        {!d.ready && <span className="text-xs text-muted-foreground">Disabled until the replica is back in sync (409 FAILOVER_NOT_READY).</span>}
        {d.refusal && <span className="text-xs text-destructive">{d.refusal}</span>}
        <span className="ml-auto"><Readiness d={d} /></span>
      </>} />
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

export function FailoverSection() {
  const d = useFailoverDrill();
  const [show, setShow] = useState<string[]>(KINDS);
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
              {KINDS.map((k) => <ToggleGroupItem key={k} value={k} className="font-mono text-xs">{k}</ToggleGroupItem>)}
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
      <p className="text-xs text-muted-foreground">Mock drill: timings come from the measured sentinel runs (played 4× faster); module outcomes for “Unresponsive master” are guesses until the real backend runs.</p>
    </div>
  );
}
