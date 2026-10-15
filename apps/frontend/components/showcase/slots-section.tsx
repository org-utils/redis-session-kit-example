// The slots section (cluster only): a key inspector with examples, the 16384-slot map with the visitor's keys plotted
// on it and each node's overview on click, the same-slot verdict, and raw vs cluster-aware runs. Every slot, range and
// count comes from the cluster itself.
'use client';

import { CheckCircle2, Grid3x3, Loader2, Play, RefreshCw, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { runOperation, type RunResult } from '@/lib/showcase/api';
import { fetchOverview, hashed, parseKeys, runBody, type RunKind } from '@/lib/showcase/cluster-slots';
import { spec, type Values } from '@/lib/showcase/examples';
import { SlotsInspectResultSchema, type SlotsInspectResult, type SlotsOverview } from '@showcase/contracts';
import { RequestForm } from './request-form';
import { Commands, HttpBadge, Json } from './result-display';

// Node identity uses the cluster mode colour at three strengths (tokens only).
const NODE_BG = ['bg-mode-cluster/25', 'bg-mode-cluster/45', 'bg-mode-cluster/65'];
const INSPECT_DEBOUNCE_MS = 300;
const port = (address: string) => address.split(':').pop();

function KeyText({ k }: { k: string }) {
  const h = hashed(k);
  return h.tag === null
    ? <span className="font-mono"><span className="rounded-sm bg-code-slot/15 text-code-slot">{h.after}</span></span>
    : <span className="font-mono text-muted-foreground">{h.before}<span className="rounded-sm bg-code-slot/15 text-code-slot">{h.tag}</span>{h.after}</span>;
}

function Verdict({ r }: { r: SlotsInspectResult }) {
  const nodes = new Set(r.groups.map((g) => g.node)).size;
  return r.sameSlot ? (
    <div className="flex gap-2 rounded-lg border border-success/50 bg-success/10 p-3 text-sm">
      <CheckCircle2 className="size-5 shrink-0 text-success" />
      <div><div className="font-medium">One slot ({r.groups[0].slot} on {port(r.groups[0].node)})</div>
        <div className="text-xs text-muted-foreground">Multi-key commands are fine and atomic: MGET, multi-key EVAL, a pipeline or MULTI.</div></div>
    </div>
  ) : (
    <div className="flex gap-2 rounded-lg border border-warning/60 bg-warning/10 p-3 text-sm">
      <XCircle className="size-5 shrink-0 text-warning" />
      <div><div className="font-medium">{r.groups.length} slots across {nodes} node{nodes > 1 ? 's' : ''}</div>
        <div className="text-xs text-muted-foreground">A raw <span className="font-mono">mget</span> or two-key <span className="font-mono">eval</span> gets CROSSSLOT. <span className="font-mono">mgetClusterAware</span> and <span className="font-mono">del</span> fan out into {r.groups.length} slot group{r.groups.length > 1 ? 's' : ''}: {r.groups.map((g) => `${g.slot} → ${port(g.node)}`).join(', ')}. Nothing across them is atomic.</div></div>
    </div>
  );
}

function RunResultCard({ r }: { r: RunResult }) {
  return (
    <Card size="sm">
      <CardHeader><CardTitle className="font-mono text-sm">{r.op}()</CardTitle><CardAction className="flex items-center gap-2 font-mono text-xs text-muted-foreground">{r.latencyMs}ms <HttpBadge code={r.httpStatus} /></CardAction></CardHeader>
      <CardContent className="space-y-2">
        <div className="text-xs text-muted-foreground">Sent, and to which node:</div>
        <Commands r={r} />
        <Json value={r.body} />
      </CardContent>
    </Card>
  );
}

function NodeDetail({ n }: { n: SlotsOverview['nodes'][number] }) {
  if (n.error) return <p className="text-xs text-destructive">{n.error}</p>;
  return (
    <div className="grid gap-4 @3xl:grid-cols-2">
      <div>
        <div className="mb-1 text-xs font-medium text-muted-foreground">showcase keys by namespace{n.truncated && ' (first 10 000 scanned)'}</div>
        <ul className="space-y-0.5 font-mono text-xs">
          {Object.entries(n.namespaces).sort().map(([ns, c]) => <li key={ns} className="flex justify-between gap-2"><span>{ns}</span><span className="text-muted-foreground">{c}</span></li>)}
          {!Object.keys(n.namespaces).length && <li className="text-muted-foreground">none</li>}
        </ul>
      </div>
      <div>
        <div className="mb-1 text-xs font-medium text-muted-foreground">client connections (every process&apos;s, CLIENT LIST)</div>
        <ul className="space-y-0.5 text-xs">
          {n.clients.map((c) => <li key={c.kind}><span className="font-mono">{c.count}×</span> {c.kind}{c.kind === 'subscriber' && <span className="text-muted-foreground"> · a Pub/Sub subscriber sits on one node only</span>}{c.kind === 'blocked read' && <span className="text-muted-foreground"> · each stream read leases a Cluster client of its own</span>}</li>)}
          {!n.clients.length && <li className="text-muted-foreground">none</li>}
        </ul>
      </div>
    </div>
  );
}

export function SlotsSection({ onResult }: { onResult: (r: RunResult) => void }) {
  const s = spec('slots', 'inspect');
  const [exampleId, setExampleId] = useState<string | null>(s.examples[0].id);
  const [values, setValues] = useState<Values>(s.examples[0].values);
  const example = s.examples.find((e) => e.id === exampleId);
  const modified = !example || JSON.stringify(values) !== JSON.stringify(example.values);
  const keysText = String(values.keys);
  const keys = parseKeys(keysText);

  // The inspection of the keys as typed, a moment after the last keystroke.
  const [inspection, setInspection] = useState<{ text: string; result: SlotsInspectResult | null; error?: string } | null>(null);
  useEffect(() => {
    const keys = parseKeys(keysText);
    if (!keys.length) return;
    let stale = false;
    const timer = setTimeout(async () => {
      const r = await runOperation('cluster', 'slots', 'inspect', () => ({ keys }));
      if (stale) return;
      const parsed = SlotsInspectResultSchema.safeParse(r.body);
      setInspection(parsed.success
        ? { text: keysText, result: parsed.data }
        : { text: keysText, result: null, error: (r.body as { error?: { message?: string } }).error?.message ?? `HTTP ${r.httpStatus}` });
    }, INSPECT_DEBOUNCE_MS);
    return () => { stale = true; clearTimeout(timer); };
  }, [keysText]);
  const r = keys.length && inspection?.text === keysText ? inspection.result : null;

  const [overview, setOverview] = useState<{ data: SlotsOverview | null; loading: boolean; error?: string }>({ data: null, loading: true });
  const refresh = async () => {
    setOverview((o) => ({ ...o, loading: true }));
    try {
      setOverview({ data: await fetchOverview(), loading: false });
    } catch (error) {
      setOverview((o) => ({ ...o, loading: false, error: error instanceof Error ? error.message : String(error) }));
    }
  };
  useEffect(() => { void refresh(); }, []);
  const [open, setOpen] = useState<string | null>(null);

  const [running, setRunning] = useState(false);
  const [res, setRes] = useState<RunResult | null>(null);
  const run = async (kind: RunKind) => {
    setRunning(true);
    const result = await runOperation('cluster', 'client', 'raw', () => runBody(kind, keys));
    setRes(result); onResult(result); setRunning(false);
  };

  // The ranges: from the last inspection (CLUSTER SHARDS), else the overview.
  const shards = r?.shards ?? overview.data?.nodes.map((n) => ({ node: n.address, slots: n.slots })) ?? [];
  const nodeInfo = (address: string) => overview.data?.nodes.find((n) => n.address === address);
  return (
    <div className="space-y-4">
      <RequestForm spec={s} values={values} modified={modified} onChange={setValues}
        selected={modified ? null : exampleId} onPick={(e) => { setExampleId(e.id); setValues(e.values); }}
        onReset={() => example && setValues(example.values)}
        footer={<>
          <Button variant="outline" size="sm" onClick={() => run('mget')} disabled={!keys.length || running}><Play /> raw mget</Button>
          <Button variant="outline" size="sm" onClick={() => run('mgetClusterAware')} disabled={!keys.length || running}><Play /> mgetClusterAware</Button>
          <Button variant="outline" size="sm" onClick={() => run('eval')} disabled={keys.length < 2 || running}><Play /> two-key eval</Button>
          <span className="text-xs text-muted-foreground">Raw commands on the cluster mode client, as in the client section.</span>
        </>} />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Grid3x3 className="size-4" /> 16384 slots</CardTitle>
          <CardDescription>Each master owns a range (CLUSTER SHARDS). Your keys are plotted where CLUSTER KEYSLOT put them; click a node for its overview.</CardDescription>
          <CardAction><Button variant="ghost" size="sm" onClick={refresh} disabled={overview.loading}>{overview.loading ? <Loader2 className="animate-spin" /> : <RefreshCw />} Refresh</Button></CardAction>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative pt-10">
            {r?.keys.map((k, i) => (
              <div key={`${k.key}-${i}`} className="absolute flex -translate-x-1/2 flex-col items-center" style={{ left: `${(k.slot / 16384) * 100}%`, top: `${(i % 3) * 12}px` }} title={`${k.key} → slot ${k.slot}`}>
                <span className="font-mono text-[10px] text-code-slot">{k.slot}</span>
                <span className="h-6 w-0.5 bg-code-slot" />
              </div>
            ))}
            <div className="flex h-10 overflow-hidden rounded-md">
              {shards.flatMap((sh, i) => sh.slots.map((range) => (
                <button key={`${sh.node}-${range.start}`} onClick={() => setOpen(open === sh.node ? null : sh.node)}
                  className={cn('flex flex-col justify-center border-r border-background px-2 text-left font-mono text-xs last:border-r-0', NODE_BG[i % NODE_BG.length], open === sh.node && 'ring-2 ring-ring ring-inset')}
                  style={{ width: `${((range.end - range.start + 1) / 16384) * 100}%` }}>
                  <span className="font-medium">{port(sh.node)}</span>
                  <span className="text-[10px] text-muted-foreground">{range.start}–{range.end}{nodeInfo(sh.node) && ` · ${nodeInfo(sh.node)!.keys} keys`}</span>
                </button>
              )))}
            </div>
          </div>
          {overview.error && <p className="text-xs text-destructive">{overview.error}</p>}
          {open && nodeInfo(open) && <div className="rounded-lg border p-3"><NodeDetail n={nodeInfo(open)!} /></div>}
          {inspection?.error && inspection.text === keysText && <p className="text-xs text-destructive">{inspection.error}</p>}
          {r && <Verdict r={r} />}
          {r && (
            <Table className="text-xs">
              <TableHeader><TableRow><TableHead>key (hashed part highlighted)</TableHead><TableHead>slot</TableHead><TableHead>node</TableHead></TableRow></TableHeader>
              <TableBody>{r.keys.map((k, i) => <TableRow key={`${k.key}-${i}`}><TableCell><KeyText k={k.key} /></TableCell><TableCell className="font-mono text-code-slot">{k.slot}</TableCell><TableCell className="font-mono">{port(k.node)}</TableCell></TableRow>)}</TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {res && <RunResultCard r={res} />}
    </div>
  );
}
