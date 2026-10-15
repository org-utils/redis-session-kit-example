// PROTOTYPE (throwaway): three variants of the slots section, switchable via ?variant=A|B|C.
// A: slot map bar. B: node columns. C: inspector table + fan-out tree, overview in a tab. All data is stubbed.
'use client';

import { CheckCircle2, GitBranch, Grid3x3, Play, Server, Users, XCircle } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type { Values } from '@/lib/showcase/examples';
import { INSPECT_SPEC, NODES, OVERVIEW, hashed, inspect, parseKeys, runOn, type NodeOverview, type RunKind } from '@/lib/showcase/cluster-slots.prototype';
import { RequestForm } from './request-form';
import { Json } from './result-display';

// Node identity uses the cluster mode colour at three strengths (tokens only).
const NODE_BG = ['bg-mode-cluster/25', 'bg-mode-cluster/45', 'bg-mode-cluster/65'];
const nodeIdx = (node: string) => NODES.findIndex((n) => n.address === node);

function useInspectForm() {
  const [exampleId, setExampleId] = useState<string | null>('plain');
  const [values, setValues] = useState<Values>(INSPECT_SPEC.examples[0].values);
  const example = INSPECT_SPEC.examples.find((e) => e.id === exampleId);
  const modified = !example || JSON.stringify(values) !== JSON.stringify(example.values);
  const keys = parseKeys(String(values.keys));
  return { exampleId, setExampleId, values, setValues, example, modified, keys, r: inspect(keys) };
}
type Form = ReturnType<typeof useInspectForm>;

function KeyText({ k }: { k: string }) {
  const h = hashed(k);
  return h.tag === null
    ? <span className="font-mono"><span className="rounded-sm bg-code-slot/15 text-code-slot">{h.after}</span></span>
    : <span className="font-mono text-muted-foreground">{h.before}<span className="rounded-sm bg-code-slot/15 text-code-slot">{h.tag}</span>{h.after}</span>;
}

function Verdict({ f }: { f: Form }) {
  const { r } = f;
  if (!f.keys.length) return null;
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

function RunButtons({ f, onRun }: { f: Form; onRun: (k: RunKind) => void }) {
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => onRun('mget')} disabled={!f.keys.length}><Play /> raw mget</Button>
      <Button variant="outline" size="sm" onClick={() => onRun('mgetClusterAware')} disabled={!f.keys.length}><Play /> mgetClusterAware</Button>
      <Button variant="outline" size="sm" onClick={() => onRun('eval')} disabled={f.keys.length < 2}><Play /> two-key eval</Button>
    </>
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

function Inspector({ f, footer }: { f: Form; footer: ReactNode }) {
  return (
    <RequestForm spec={INSPECT_SPEC} values={f.values} modified={f.modified} onChange={f.setValues}
      selected={f.modified ? null : f.exampleId} onPick={(e) => { f.setExampleId(e.id); f.setValues(e.values); }}
      onReset={() => f.example && f.setValues(f.example.values)} footer={footer} />
  );
}

function Clients({ n }: { n: NodeOverview }) {
  return <ul className="space-y-0.5 text-xs">{n.clients.map((c) => <li key={c.name}><span className="font-mono">{c.count}×</span> {c.name}{c.note && <span className="text-muted-foreground"> · {c.note}</span>}</li>)}</ul>;
}
function Namespaces({ n }: { n: NodeOverview }) {
  return <ul className="space-y-0.5 font-mono text-xs">{Object.entries(n.namespaces).map(([ns, c]) => <li key={ns} className="flex justify-between gap-2"><span>{ns}</span><span className="text-muted-foreground">{c}</span></li>)}</ul>;
}

/* ───────────── Variant A: slot map bar ───────────── */
function VariantA() {
  const f = useInspectForm();
  const [res, setRes] = useState<ReturnType<typeof runOn> | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="space-y-4">
      <Inspector f={f} footer={<RunButtons f={f} onRun={(k) => setRes(runOn(k, f.keys))} />} />
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Grid3x3 className="size-4" /> 16384 slots</CardTitle><CardDescription>Each node owns a range. Your keys are plotted where their slot falls; click a node for its overview.</CardDescription><CardAction><Button variant="ghost" size="sm">Refresh</Button></CardAction></CardHeader>
        <CardContent className="space-y-4">
          <div className="relative pt-10">
            {f.r.infos.map((k, i) => (
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
          <Verdict f={f} />
          <Table className="text-xs">
            <TableHeader><TableRow><TableHead>key (hashed part highlighted)</TableHead><TableHead>slot</TableHead><TableHead>node</TableHead></TableRow></TableHeader>
            <TableBody>{f.r.infos.map((k) => <TableRow key={k.key}><TableCell><KeyText k={k.key} /></TableCell><TableCell className="font-mono text-code-slot">{k.slot}</TableCell><TableCell className="font-mono">{k.node.split(':')[1]}</TableCell></TableRow>)}</TableBody>
          </Table>
        </CardContent>
      </Card>
      <RunResultCard res={res} />
    </div>
  );
}

/* ───────────── Variant B: node columns ───────────── */
function VariantB() {
  const f = useInspectForm();
  const [res, setRes] = useState<ReturnType<typeof runOn> | null>(null);
  return (
    <div className="space-y-4">
      <Inspector f={f} footer={<span className="text-xs text-muted-foreground">Your keys drop into the node that owns their slot below.</span>} />
      <div className="flex flex-wrap items-center gap-2"><div className="min-w-0 flex-1"><Verdict f={f} /></div><RunButtons f={f} onRun={(k) => setRes(runOn(k, f.keys))} /></div>
      <div className="grid gap-4 @4xl:grid-cols-3">
        {OVERVIEW.map((n, i) => {
          const groups = f.r.groups.filter((g) => g.node === n.address);
          return (
            <Card key={n.port} size="sm" className="min-w-0">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 font-mono text-sm"><span className={cn('size-3 rounded-sm', NODE_BG[i])} /><Server className="size-4" /> {n.address}</CardTitle>
                <CardDescription className="font-mono">slots {n.from}–{n.to} · {n.keys} keys</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="min-h-16 space-y-1.5 rounded-md border border-dashed p-2">
                  {groups.length ? groups.map((g) => (
                    <div key={g.slot}>
                      <Badge variant="outline" className="font-mono text-code-slot">slot {g.slot}</Badge>
                      <ul className="mt-0.5 space-y-0.5 text-xs">{g.keys.map((k) => <li key={k}><KeyText k={k} /></li>)}</ul>
                      {f.r.groups.length > 1 && <div className="font-mono text-[10px] text-muted-foreground">mgetClusterAware → MGET {g.keys.length} key{g.keys.length > 1 ? 's' : ''} here</div>}
                    </div>
                  )) : <p className="text-xs text-muted-foreground">none of your keys</p>}
                </div>
                <div><div className="mb-1 text-xs font-medium text-muted-foreground">showcase keys by namespace</div><Namespaces n={n} /></div>
                <div><div className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground"><Users className="size-3.5" /> client connections</div><Clients n={n} /></div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <RunResultCard res={res} />
    </div>
  );
}

/* ───────────── Variant C: inspector table + fan-out tree, overview tab ───────────── */
function VariantC() {
  const f = useInspectForm();
  const [res, setRes] = useState<ReturnType<typeof runOn> | null>(null);
  return (
    <Tabs defaultValue="inspect" className="space-y-4">
      <TabsList><TabsTrigger value="inspect">Key inspector</TabsTrigger><TabsTrigger value="overview">Nodes</TabsTrigger></TabsList>
      <TabsContent value="inspect" className="space-y-4">
        <Inspector f={f} footer={<RunButtons f={f} onRun={(k) => setRes(runOn(k, f.keys))} />} />
        <div className="grid gap-4 @5xl:grid-cols-[minmax(0,1fr)_20rem]">
          <Card size="sm" className="min-w-0">
            <CardHeader><CardTitle>Keys</CardTitle></CardHeader>
            <CardContent>
              <Table className="text-xs">
                <TableHeader><TableRow><TableHead>key</TableHead><TableHead>hashed part</TableHead><TableHead>slot</TableHead><TableHead>node</TableHead><TableHead>group</TableHead></TableRow></TableHeader>
                <TableBody>{f.r.infos.map((k) => {
                  const h = hashed(k.key), g = f.r.groups.findIndex((x) => x.slot === k.slot);
                  return <TableRow key={k.key}><TableCell><KeyText k={k.key} /></TableCell><TableCell className="font-mono">{h.tag ?? <span className="text-muted-foreground">whole key</span>}</TableCell><TableCell className="font-mono text-code-slot">{k.slot}</TableCell><TableCell className="font-mono">{k.node.split(':')[1]}</TableCell><TableCell><Badge variant="outline" className="font-mono">#{g + 1}</Badge></TableCell></TableRow>;
                })}</TableBody>
              </Table>
            </CardContent>
          </Card>
          <div className="space-y-4">
            <Verdict f={f} />
            <Card size="sm">
              <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><GitBranch className="size-4" /> Fan-out plan</CardTitle><CardDescription>What mgetClusterAware and del send.</CardDescription></CardHeader>
              <CardContent className="font-mono text-xs">
                <div>mgetClusterAware({f.keys.length} keys)</div>
                <ul className="ml-3 border-l pl-3">
                  {NODES.map((n) => {
                    const gs = f.r.groups.filter((g) => g.node === n.address);
                    if (!gs.length) return null;
                    return <li key={n.port} className="py-0.5">{n.port}<ul className="ml-3 border-l pl-3">{gs.map((g) => <li key={g.slot} className="text-muted-foreground">slot <span className="text-code-slot">{g.slot}</span>: MGET {g.keys.length}</li>)}</ul></li>;
                  })}
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
        <RunResultCard res={res} />
      </TabsContent>
      <TabsContent value="overview">
        <Card>
          <CardHeader><CardTitle>Nodes</CardTitle><CardDescription>Refreshed on demand.</CardDescription><CardAction><Button variant="ghost" size="sm">Refresh</Button></CardAction></CardHeader>
          <CardContent>
            <Table className="text-xs">
              <TableHeader><TableRow><TableHead>node</TableHead><TableHead>slots</TableHead><TableHead>keys</TableHead><TableHead>showcase keys</TableHead><TableHead>clients</TableHead></TableRow></TableHeader>
              <TableBody>{OVERVIEW.map((n) => (
                <TableRow key={n.port} className="align-top">
                  <TableCell className="font-mono">{n.address}</TableCell><TableCell className="font-mono">{n.from}–{n.to}</TableCell><TableCell className="font-mono">{n.keys}</TableCell>
                  <TableCell><Namespaces n={n} /></TableCell><TableCell><Clients n={n} /></TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

export const SLOTS_VARIANTS = [
  { key: 'A', name: 'Slot map' }, { key: 'B', name: 'Node columns' }, { key: 'C', name: 'Table + fan-out tree' },
];

export function SlotsPrototype({ variant }: { variant: string }) {
  return variant === 'B' ? <VariantB /> : variant === 'C' ? <VariantC /> : <VariantA />;
}
