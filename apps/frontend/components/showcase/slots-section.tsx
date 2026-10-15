// The slots section (cluster only): a key inspector with examples, the 16384-slot map with the visitor's keys plotted
// on it and each node's overview on click, the same-slot verdict, and raw vs cluster-aware runs.
'use client';

import { CheckCircle2, Grid3x3, Play, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { spec, type Values } from '@/lib/showcase/examples';
import { NODES, OVERVIEW, hashed, inspect, parseKeys, runOn, type NodeOverview, type RunKind } from '@/lib/showcase/cluster-slots';
import { RequestForm } from './request-form';
import { Json } from './result-display';

// Node identity uses the cluster mode colour at three strengths (tokens only).
const NODE_BG = ['bg-mode-cluster/25', 'bg-mode-cluster/45', 'bg-mode-cluster/65'];

function KeyText({ k }: { k: string }) {
  const h = hashed(k);
  return h.tag === null
    ? <span className="font-mono"><span className="rounded-sm bg-code-slot/15 text-code-slot">{h.after}</span></span>
    : <span className="font-mono text-muted-foreground">{h.before}<span className="rounded-sm bg-code-slot/15 text-code-slot">{h.tag}</span>{h.after}</span>;
}

function Verdict({ r }: { r: ReturnType<typeof inspect> }) {
  if (!r.infos.length) return null;
  return r.sameSlot ? (
    <div className="flex gap-2 rounded-lg border border-success/50 bg-success/10 p-3 text-sm">
      <CheckCircle2 className="size-5 shrink-0 text-success" />
      <div><div className="font-medium">One slot ({r.groups[0].slot} on {r.groups[0].node.split(':')[1]})</div>
        <div className="text-xs text-muted-foreground">Multi-key commands are fine and atomic: MGET, multi-key EVAL, a pipeline or MULTI.</div></div>
    </div>
  ) : (
    <div className="flex gap-2 rounded-lg border border-warning/60 bg-warning/10 p-3 text-sm">
      <XCircle className="size-5 shrink-0 text-warning" />
      <div><div className="font-medium">{r.groups.length} slots across {r.nodeCount} node{r.nodeCount > 1 ? 's' : ''}</div>
        <div className="text-xs text-muted-foreground">A raw <span className="font-mono">mget</span> or two-key <span className="font-mono">eval</span> gets CROSSSLOT. <span className="font-mono">mgetClusterAware</span> and <span className="font-mono">del</span> fan out into {r.groups.length} slot group{r.groups.length > 1 ? 's' : ''}; nothing across them is atomic.</div></div>
    </div>
  );
}

function RunResultCard({ res }: { res: ReturnType<typeof runOn> | null }) {
  if (!res) return null;
  return (
    <Card size="sm">
      <CardHeader><CardTitle className="font-mono text-sm">{res.command}</CardTitle><CardAction>{res.ok ? <Badge className="bg-success text-success-foreground">200</Badge> : <Badge variant="destructive">502</Badge>}</CardAction></CardHeader>
      <CardContent className="space-y-2">
        <ul className="font-mono text-xs text-muted-foreground">{res.sent.map((s) => <li key={s}>{s}</li>)}</ul>
        <Json value={res.ok ? res.result : { error: { code: 'CROSSSLOT', message: res.error } }} />
      </CardContent>
    </Card>
  );
}

function Clients({ n }: { n: NodeOverview }) {
  return <ul className="space-y-0.5 text-xs">{n.clients.map((c) => <li key={c.name}><span className="font-mono">{c.count}×</span> {c.name}{c.note && <span className="text-muted-foreground"> · {c.note}</span>}</li>)}</ul>;
}
function Namespaces({ n }: { n: NodeOverview }) {
  return <ul className="space-y-0.5 font-mono text-xs">{Object.entries(n.namespaces).map(([ns, c]) => <li key={ns} className="flex justify-between gap-2"><span>{ns}</span><span className="text-muted-foreground">{c}</span></li>)}</ul>;
}

export function SlotsSection() {
  const s = spec('slots', 'inspect');
  const [exampleId, setExampleId] = useState<string | null>(s.examples[0].id);
  const [values, setValues] = useState<Values>(s.examples[0].values);
  const example = s.examples.find((e) => e.id === exampleId);
  const modified = !example || JSON.stringify(values) !== JSON.stringify(example.values);
  const keys = parseKeys(String(values.keys));
  const r = inspect(keys);
  const [res, setRes] = useState<ReturnType<typeof runOn> | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const run = (k: RunKind) => setRes(runOn(k, keys));
  return (
    <div className="space-y-4">
      <RequestForm spec={s} values={values} modified={modified} onChange={setValues}
        selected={modified ? null : exampleId} onPick={(e) => { setExampleId(e.id); setValues(e.values); }}
        onReset={() => example && setValues(example.values)}
        footer={<>
          <Button variant="outline" size="sm" onClick={() => run('mget')} disabled={!keys.length}><Play /> raw mget</Button>
          <Button variant="outline" size="sm" onClick={() => run('mgetClusterAware')} disabled={!keys.length}><Play /> mgetClusterAware</Button>
          <Button variant="outline" size="sm" onClick={() => run('eval')} disabled={keys.length < 2}><Play /> two-key eval</Button>
        </>} />
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Grid3x3 className="size-4" /> 16384 slots</CardTitle><CardDescription>Each node owns a range. Your keys are plotted where their slot falls; click a node for its overview.</CardDescription><CardAction><Button variant="ghost" size="sm">Refresh</Button></CardAction></CardHeader>
        <CardContent className="space-y-4">
          <div className="relative pt-10">
            {r.infos.map((k, i) => (
              <div key={k.key} className="absolute flex -translate-x-1/2 flex-col items-center" style={{ left: `${(k.slot / 16384) * 100}%`, top: `${(i % 3) * 12}px` }} title={`${k.key} → slot ${k.slot}`}>
                <span className="font-mono text-[10px] text-code-slot">{k.slot}</span>
                <span className="h-6 w-0.5 bg-code-slot" />
              </div>
            ))}
            <div className="flex h-10 overflow-hidden rounded-md">
              {NODES.map((n, i) => (
                <button key={n.port} onClick={() => setOpen(open === i ? null : i)} className={cn('flex flex-col justify-center border-r border-background px-2 text-left font-mono text-xs last:border-r-0', NODE_BG[i], open === i && 'ring-2 ring-ring ring-inset')} style={{ width: `${((n.to - n.from + 1) / 16384) * 100}%` }}>
                  <span className="font-medium">{n.port}</span><span className="text-[10px] text-muted-foreground">{n.from}–{n.to} · {OVERVIEW[i].keys} keys</span>
                </button>
              ))}
            </div>
          </div>
          {open !== null && (
            <div className="grid gap-4 rounded-lg border p-3 @3xl:grid-cols-2">
              <div><div className="mb-1 text-xs font-medium text-muted-foreground">showcase keys by namespace</div><Namespaces n={OVERVIEW[open]} /></div>
              <div><div className="mb-1 text-xs font-medium text-muted-foreground">client connections</div><Clients n={OVERVIEW[open]} /></div>
            </div>
          )}
          <Verdict r={r} />
          <Table className="text-xs">
            <TableHeader><TableRow><TableHead>key (hashed part highlighted)</TableHead><TableHead>slot</TableHead><TableHead>node</TableHead></TableRow></TableHeader>
            <TableBody>{r.infos.map((k) => <TableRow key={k.key}><TableCell><KeyText k={k.key} /></TableCell><TableCell className="font-mono text-code-slot">{k.slot}</TableCell><TableCell className="font-mono">{k.node.split(':')[1]}</TableCell></TableRow>)}</TableBody>
          </Table>
        </CardContent>
      </Card>
      <RunResultCard res={res} />
    </div>
  );
}
