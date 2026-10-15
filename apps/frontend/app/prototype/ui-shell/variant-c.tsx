// PROTOTYPE variant C: console timeline. Icon rail, a composer with mode toggles, one history mixing runs and events, a detail pane.
'use client';

import { CornerDownLeft, Database } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ThemeToggle } from '@/components/theme-toggle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { CliSnippet, Commands, HealthDot, HttpBadge, InsightLink, Json, KeysTable, ModeName } from './bits';
import { MODES, MODULES, runOp, useStubLive, type RunResult, type ShowcaseEvent } from './stub';

export const name = 'Console timeline';

type Entry = { ts: number; kind: 'run'; runs: RunResult[]; label: string } | { ts: number; kind: 'event'; e: ShowcaseEvent };

export function VariantC() {
  const { status, events, simulateFailover } = useStubLive();
  const [moduleId, setModuleId] = useState('cache');
  const mod = MODULES.find((m) => m.id === moduleId)!;
  const [opId, setOpId] = useState(mod.ops[0].id);
  const op = mod.ops.find((o) => o.id === opId) ?? mod.ops[0];
  const [input, setInput] = useState(op.input);
  const [chips, setChips] = useState<string[]>(['standalone', 'cluster']);
  const [history, setHistory] = useState<Array<{ ts: number; runs: RunResult[]; label: string }>>([]);
  const [selected, setSelected] = useState<RunResult | null>(null);
  const [showEvents, setShowEvents] = useState(true);

  const pick = (id: string) => {
    const m = MODULES.find((x) => x.id === id)!;
    setModuleId(id); setOpId(m.ops[0].id); setInput(m.ops[0].input);
    if (m.onlyMode) setChips([m.onlyMode]);
  };
  const run = () => {
    const modes = mod.onlyMode ? [mod.onlyMode] : MODES.filter((m) => chips.includes(m));
    const runs = modes.map((md) => runOp(md, moduleId, op.id, input, status[md]));
    setHistory((h) => [{ ts: Date.now(), runs, label: `${mod.id}.${op.label}(${input})` }, ...h]);
    setSelected(runs[0] ?? null);
    if (mod.id === 'failover') simulateFailover();
  };

  const timeline = useMemo<Entry[]>(() => {
    const all: Entry[] = [
      ...history.map((h) => ({ ...h, kind: 'run' as const })),
      ...(showEvents ? events.map((e) => ({ ts: e.ts, kind: 'event' as const, e })) : []),
    ];
    return all.sort((a, b) => b.ts - a.ts);
  }, [history, events, showEvents]);

  return (
    <div className="flex h-svh bg-background">
      {/* icon rail */}
      <nav className="flex w-14 shrink-0 flex-col items-center gap-1 border-r bg-sidebar py-3">
        <Database className="mb-2 size-5 text-muted-foreground" />
        {MODULES.map((m) => (
          <Tooltip key={m.id}>
            <TooltipTrigger asChild>
              <Button variant={moduleId === m.id ? 'default' : 'ghost'} size="icon-lg" onClick={() => pick(m.id)}
                className={cn('font-mono text-xs', m.kind === 'mode-specific' && 'mt-1 ring-1 ring-border')}>
                {m.label.slice(0, 2)}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{m.label}{m.onlyMode && ` · ${m.onlyMode} only`}</TooltipContent>
          </Tooltip>
        ))}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* status strip */}
        <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
          {MODES.map((md) => (
            <Badge key={md} variant="outline" className="gap-2 py-1">
              <HealthDot health={status[md].health} /><ModeName mode={md} />
              <span className="font-mono text-muted-foreground">{status[md].latencyMs}ms</span>
              {md === 'sentinel' && <span className={status.sentinel.failoverReady ? 'text-success' : 'text-destructive'}>{status.sentinel.failoverReady ? 'failover ready' : 'not failover ready'}</span>}
            </Badge>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <Checkbox id="evts" checked={showEvents} onCheckedChange={(v) => setShowEvents(v === true)} />
            <Label htmlFor="evts" className="text-xs text-muted-foreground">Events in timeline</Label>
            <ThemeToggle />
          </div>
        </div>

        {/* composer */}
        <div className="shrink-0 space-y-1 border-b bg-muted/30 px-4 py-3">
          <div className="flex items-center gap-2 font-mono text-sm">
            <span className="text-muted-foreground">{mod.id}.</span>
            <Select value={op.id} onValueChange={(v) => { setOpId(v); setInput(mod.ops.find((o) => o.id === v)!.input); }}>
              <SelectTrigger size="sm" className="w-36 font-mono"><SelectValue /></SelectTrigger>
              <SelectContent>{mod.ops.map((o) => <SelectItem key={o.id} value={o.id} className="font-mono">{o.label}</SelectItem>)}</SelectContent>
            </Select>
            <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder={op.placeholder} onKeyDown={(e) => e.key === 'Enter' && run()} className="h-8 min-w-0 flex-1 font-mono" />
            <span className="text-muted-foreground">on</span>
            <ToggleGroup type="multiple" variant="outline" size="sm" value={mod.onlyMode ? [mod.onlyMode] : chips} onValueChange={setChips} disabled={!!mod.onlyMode}>
              {MODES.map((md) => <ToggleGroupItem key={md} value={md}><ModeName mode={md} /></ToggleGroupItem>)}
            </ToggleGroup>
            <Button size="sm" onClick={run}><CornerDownLeft /> Run</Button>
          </div>
          <p className="text-xs text-muted-foreground">{mod.blurb}</p>
        </div>

        {/* timeline */}
        <ScrollArea className="min-h-0 flex-1">
          <ol className="space-y-2 p-4 pb-16">
            {!timeline.length && <p className="text-sm text-muted-foreground">Type an operation and press Enter. Runs and background events pile up here, newest first.</p>}
            {timeline.map((en) => en.kind === 'event' ? (
              <li key={`e${en.e.id}`} className="flex gap-3 border-l-2 border-warning pl-3 font-mono text-[11px]">
                <span className="text-muted-foreground">{en.e.at}</span><ModeName mode={en.e.mode} />
                <span className={en.e.kind === 'error' ? 'text-destructive' : 'text-warning'}>{en.e.text}</span>
              </li>
            ) : (
              <li key={`r${en.ts}`}>
                <Card size="sm" className="gap-2">
                  <CardHeader><CardTitle className="font-mono text-sm">{en.label}</CardTitle></CardHeader>
                  <CardContent className="space-y-1">
                    {en.runs.map((r) => (
                      <Button key={r.id} variant={selected?.id === r.id ? 'secondary' : 'ghost'} size="sm" onClick={() => setSelected(r)} className="w-full justify-start gap-3 font-mono text-xs">
                        <ModeName mode={r.mode} className="w-20 text-left" /><HttpBadge code={r.httpStatus} />
                        <span className="w-14 text-muted-foreground">{r.latencyMs}ms</span>
                        <span className="truncate">{JSON.stringify(r.body)}</span>
                      </Button>
                    ))}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ol>
        </ScrollArea>
      </div>

      {/* detail pane */}
      <aside className="w-96 shrink-0 border-l bg-muted/30">
        <ScrollArea className="h-full">
          <div className="space-y-4 p-4 pb-16">
            {selected ? (
              <>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold"><ModeName mode={selected.mode} /> · {selected.module}.{selected.op}</h3>
                  <HttpBadge code={selected.httpStatus} />
                </div>
                <Json value={selected.body} />
                <Separator />
                <div className="space-y-1"><Label className="text-xs text-muted-foreground">Keys touched</Label><KeysTable keys={selected.keys} mode={selected.mode} /></div>
                <div className="space-y-1"><Label className="text-xs text-muted-foreground">Commands</Label><Commands r={selected} /></div>
                <InsightLink mode={selected.mode} />
                <CliSnippet mode={selected.mode} />
              </>
            ) : <p className="text-sm text-muted-foreground">Select a run to inspect its keys, commands and links.</p>}
          </div>
        </ScrollArea>
      </aside>
    </div>
  );
}
