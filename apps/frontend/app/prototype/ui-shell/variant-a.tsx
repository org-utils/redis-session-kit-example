// PROTOTYPE variant A: shadcn Sidebar app, one mode at a time, compare toggle, right-hand Redis state rail, collapsible event log.
'use client';

import { ChevronsUpDown, Database, Play } from 'lucide-react';
import { useState } from 'react';
import { ThemeToggle } from '@/components/theme-toggle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu,
  SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger,
} from '@/components/ui/sidebar';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { CliSnippet, Commands, HealthDot, HttpBadge, InsightLink, Json, KeysTable, ModeName } from './bits';
import { MODES, MODULES, healthText, runOp, useStubLive, type Mode, type RunResult } from './stub';

export const name = 'Sidebar, one mode at a time';

export function VariantA() {
  const { status, events, simulateFailover } = useStubLive();
  const [mode, setMode] = useState<Mode>('standalone');
  const [moduleId, setModuleId] = useState('cache');
  const mod = MODULES.find((m) => m.id === moduleId)!;
  const [opId, setOpId] = useState(mod.ops[0].id);
  const op = mod.ops.find((o) => o.id === opId) ?? mod.ops[0];
  const [input, setInput] = useState(op.input);
  const [compare, setCompare] = useState(false);
  const [results, setResults] = useState<RunResult[]>([]);

  const pickModule = (id: string) => {
    const m = MODULES.find((x) => x.id === id)!;
    setModuleId(id); setOpId(m.ops[0].id); setInput(m.ops[0].input); setResults([]);
    if (m.onlyMode) { setMode(m.onlyMode); setCompare(false); }
  };
  const run = () => setResults((compare ? MODES : [mode]).map((md) => runOp(md, moduleId, op.id, input, status[md])));
  const focus = results.find((r) => r.mode === mode) ?? results[0];
  const s = status[focus?.mode ?? mode];

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg">
                <Database />
                <div className="grid leading-tight"><span className="font-semibold">ioredis-toolkit</span><span className="text-xs text-muted-foreground">showcase</span></div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Connection mode</SidebarGroupLabel>
            <SidebarMenu>
              {MODES.map((md) => (
                <SidebarMenuItem key={md}>
                  <SidebarMenuButton isActive={mode === md} disabled={!!mod.onlyMode && mod.onlyMode !== md} tooltip={md}
                    onClick={() => { setMode(md); setResults([]); }}>
                    <HealthDot health={status[md].health} /><ModeName mode={md} />
                  </SidebarMenuButton>
                  <SidebarMenuBadge className="font-mono">{status[md].latencyMs}ms</SidebarMenuBadge>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Feature modules</SidebarGroupLabel>
            <SidebarMenu>
              {MODULES.filter((m) => m.kind === 'feature').map((m) => (
                <SidebarMenuItem key={m.id}>
                  <SidebarMenuButton isActive={moduleId === m.id} tooltip={m.label} onClick={() => pickModule(m.id)}>
                    <span className="font-mono text-xs text-muted-foreground">{m.label.slice(0, 2)}</span>{m.label}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Mode-specific</SidebarGroupLabel>
            <SidebarMenu>
              {MODULES.filter((m) => m.kind === 'mode-specific').map((m) => (
                <SidebarMenuItem key={m.id}>
                  <SidebarMenuButton isActive={moduleId === m.id} tooltip={m.label} onClick={() => pickModule(m.id)}>
                    <span className="font-mono text-xs text-muted-foreground">{m.label.slice(0, 2)}</span>{m.label}
                  </SidebarMenuButton>
                  <SidebarMenuBadge><ModeName mode={m.onlyMode!} className="text-xs" /></SidebarMenuBadge>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      <SidebarInset className="flex h-svh flex-col overflow-hidden">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-4" />
          <span className="text-sm font-medium">{mod.label}</span>
          <span className="text-sm text-muted-foreground">on {compare ? 'all modes' : mode}</span>
          <div className="ml-auto"><ThemeToggle /></div>
        </header>

        <div className="flex min-h-0 flex-1">
          <ScrollArea className="min-w-0 flex-1">
            <div className="space-y-5 p-6">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">{mod.label}</h1>
                <p className="text-sm text-muted-foreground">{mod.blurb}</p>
              </div>
              <Tabs value={op.id} onValueChange={(v) => { setOpId(v); setInput(mod.ops.find((o) => o.id === v)!.input); }}>
                <TabsList variant="line">
                  {mod.ops.map((o) => <TabsTrigger key={o.id} value={o.id} className="font-mono">{o.label}</TabsTrigger>)}
                </TabsList>
              </Tabs>
              <div className="flex flex-wrap items-center gap-3">
                {op.placeholder && <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder={op.placeholder} className="w-72 font-mono" />}
                <Button onClick={run}><Play /> Run</Button>
                {!mod.onlyMode && (
                  <div className="flex items-center gap-2">
                    <Checkbox id="compare" checked={compare} onCheckedChange={(v) => setCompare(v === true)} />
                    <Label htmlFor="compare" className="text-muted-foreground">Compare across all modes</Label>
                  </div>
                )}
                {mod.id === 'failover' && <Button variant="outline" onClick={simulateFailover}>Simulate failover in status</Button>}
              </div>
              <div className={cn('grid gap-4', results.length > 1 ? 'grid-cols-3' : 'grid-cols-1')}>
                {results.map((r) => (
                  <Card key={r.id} size="sm" onClick={() => setMode(r.mode)} className={cn('cursor-pointer', r.mode === focus?.mode && 'ring-2 ring-ring')}>
                    <CardHeader className="flex flex-row items-center justify-between">
                      <CardTitle><ModeName mode={r.mode} /></CardTitle>
                      <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">{r.latencyMs}ms <HttpBadge code={r.httpStatus} /></div>
                    </CardHeader>
                    <CardContent><Json value={r.body} /></CardContent>
                  </Card>
                ))}
                {!results.length && <p className="text-sm text-muted-foreground">Run an operation to see its result here.</p>}
              </div>
            </div>
          </ScrollArea>

          {/* right rail: raw Redis state */}
          <aside className="w-96 shrink-0 border-l bg-muted/30">
            <ScrollArea className="h-full">
              <div className="space-y-4 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium uppercase text-muted-foreground">Redis state</span>
                  <ModeName mode={focus?.mode ?? mode} className="text-sm" />
                </div>
                {focus ? (
                  <>
                    <div className="space-y-1"><Label className="text-xs text-muted-foreground">Keys touched</Label><KeysTable keys={focus.keys} mode={focus.mode} /></div>
                    <div className="space-y-1"><Label className="text-xs text-muted-foreground">Commands sent</Label><Commands r={focus} /></div>
                  </>
                ) : <p className="text-xs text-muted-foreground">Nothing yet.</p>}
                <Separator />
                <div className="space-y-2 text-xs">
                  <div className={cn('font-medium', healthText[s.health])}>{s.health} · {s.latencyMs}ms</div>
                  <div className="text-muted-foreground">{s.detail.join(' · ')}</div>
                  {s.failoverReady !== undefined && (
                    <Badge variant={s.failoverReady ? 'secondary' : 'destructive'}>{s.failoverReady ? 'failover ready' : 'not failover ready'}</Badge>
                  )}
                  <div><InsightLink mode={focus?.mode ?? mode} /></div>
                  <CliSnippet mode={focus?.mode ?? mode} />
                </div>
              </div>
            </ScrollArea>
          </aside>
        </div>

        {/* bottom: event log */}
        <Collapsible defaultOpen className="shrink-0 border-t">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full justify-between rounded-none text-muted-foreground">
              Event log · all modes <Badge variant="secondary">{events.length}</Badge><ChevronsUpDown className="ml-auto" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ScrollArea className="h-32">
              <ul className="px-4 pb-14 font-mono text-xs">
                {events.map((e) => (
                  <li key={e.id} className="flex gap-3 py-0.5">
                    <span className="text-muted-foreground">{e.at}</span><ModeName mode={e.mode} className="w-20" />
                    <span className={e.kind === 'error' ? 'text-destructive' : 'text-warning'}>{e.text}</span>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </CollapsibleContent>
        </Collapsible>
      </SidebarInset>
    </SidebarProvider>
  );
}
