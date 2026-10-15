// PROTOTYPE: built-in example picker and the editable request form, composed from shadcn primitives.
'use client';

import { Code2, RotateCcw } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { Example, Field, OpSpec, Value, Values } from './examples';

export type ExampleLayout = 'grid' | 'list' | 'inline';
export const EXAMPLE_LAYOUTS = [
  { key: 'grid', name: 'Cards filling the row' },
  { key: 'list', name: 'List beside the form' },
  { key: 'inline', name: 'Dropdown in the form' },
];

/** grid: equal columns that always fill the row (auto-fit), never leaving a gap on the right. */
function ExampleGrid({ examples, selected, onPick }: { examples: Example[]; selected: string | null; onPick: (e: Example) => void }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium uppercase text-muted-foreground">Examples</div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-2">
        {examples.map((e) => (
          <Card key={e.id} size="sm" role="button" tabIndex={0} onClick={() => onPick(e)} onKeyDown={(k) => k.key === 'Enter' && onPick(e)}
            className={cn('cursor-pointer gap-1 transition-colors hover:bg-accent', selected === e.id && 'ring-2 ring-primary')}>
            <CardHeader>
              <CardTitle className="text-sm">{e.title}</CardTitle>
              <CardDescription className="text-xs">{e.description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}

/** list: a vertical list beside the form (pick on the left, edit on the right). */
function ExampleList({ examples, selected, onPick }: { examples: Example[]; selected: string | null; onPick: (e: Example) => void }) {
  return (
    <div className="space-y-1">
      <div className="px-2 pb-1 text-xs font-medium uppercase text-muted-foreground">Examples</div>
      {examples.map((e) => (
        <Button key={e.id} variant={selected === e.id ? 'secondary' : 'ghost'} onClick={() => onPick(e)}
          className="h-auto w-full flex-col items-start gap-0.5 whitespace-normal px-3 py-2 text-left">
          <span className="text-sm font-medium">{e.title}</span>
          <span className="text-xs font-normal text-muted-foreground">{e.description}</span>
        </Button>
      ))}
    </div>
  );
}

export interface TokenOption { value: string; label: string }

function FieldInput({ field, value, onChange, tokens }: { field: Field; value: Value; onChange: (v: Value) => void; tokens?: TokenOption[] }) {
  const id = `f-${field.name}`;
  switch (field.kind) {
    case 'json':
      return <Textarea id={id} value={String(value)} onChange={(e) => onChange(e.target.value)} rows={3} className="font-mono text-xs" />;
    case 'number':
      return <Input id={id} type="number" step="any" value={String(value)} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} className="font-mono" />;
    case 'boolean':
      return <Switch id={id} checked={value === true} onCheckedChange={onChange} />;
    case 'select':
      return (
        <Select value={String(value)} onValueChange={onChange}>
          <SelectTrigger id={id} className="w-full font-mono"><SelectValue /></SelectTrigger>
          <SelectContent>{field.options!.map((o) => <SelectItem key={o} value={o} className="font-mono">{o}</SelectItem>)}</SelectContent>
        </Select>
      );
    case 'token': {
      const known = tokens?.some((t) => t.value === value);
      return (
        <div className="col-span-2 flex gap-2">
          <Select value={known ? String(value) : '$custom'} onValueChange={(v) => onChange(v === '$custom' ? '' : v)}>
            <SelectTrigger id={id} className="w-64 font-mono"><SelectValue /></SelectTrigger>
            <SelectContent>
              {tokens?.map((t) => <SelectItem key={t.value} value={t.value} className="font-mono">{t.label}</SelectItem>)}
              <SelectItem value="$custom">type a token…</SelectItem>
            </SelectContent>
          </Select>
          {!known && <Input value={String(value)} onChange={(e) => onChange(e.target.value)} placeholder="j_xxxx.secret" className="font-mono" />}
        </div>
      );
    }
    default:
      return <Input id={id} value={String(value)} onChange={(e) => onChange(e.target.value)} className="font-mono" />;
  }
}

export function RequestForm({ spec, values, modified, onChange, onReset, footer, tokens, selected, onPick }: {
  spec: OpSpec; values: Values; modified: boolean; onChange: (v: Values) => void; onReset: () => void; footer: ReactNode; tokens?: TokenOption[];
  selected: string | null; onPick: (e: Example) => void;
}) {
  // PROTOTYPE: ?examples=grid|list|inline picks how examples sit relative to the form.
  const layout = (useSearchParams().get('examples') ?? 'grid') as ExampleLayout;
  const current = spec.examples.find((e) => e.id === selected);
  const card = (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Request</CardTitle>
        {layout === 'inline' ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Select value={selected ?? '$edited'} onValueChange={(id) => { const e = spec.examples.find((x) => x.id === id); if (e) onPick(e); }}>
              <SelectTrigger className="w-72"><SelectValue placeholder="Pick an example" /></SelectTrigger>
              <SelectContent>
                {spec.examples.map((e) => <SelectItem key={e.id} value={e.id}>{e.title}</SelectItem>)}
                {!selected && <SelectItem value="$edited" disabled>Edited</SelectItem>}
              </SelectContent>
            </Select>
            <CardDescription className="text-xs">{current?.description ?? 'Your own values.'}</CardDescription>
          </div>
        ) : <CardDescription>Start from an example, then change anything.</CardDescription>}
        <CardAction className="flex items-center gap-2">
          {modified && <Badge variant="secondary">Modified</Badge>}
          <Button variant="ghost" size="sm" onClick={onReset} disabled={!modified}><RotateCcw /> Reset</Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          {spec.fields.map((f) => (
            <div key={f.name} className={cn('space-y-1.5', (f.kind === 'json' || f.kind === 'token') && 'col-span-2', f.kind === 'boolean' && 'col-span-2 flex items-center gap-3 space-y-0')}>
              <Label htmlFor={`f-${f.name}`} className={cn('font-mono text-xs', f.kind === 'boolean' && 'order-last')}>{f.label}</Label>
              <FieldInput field={f} value={values[f.name] ?? ''} tokens={tokens} onChange={(v) => onChange({ ...values, [f.name]: v })} />
              {f.help && f.kind !== 'boolean' && <p className="text-xs text-muted-foreground">{f.help}</p>}
            </div>
          ))}
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground"><Code2 className="size-3.5" /> Equivalent call</Label>
          <pre className="overflow-x-auto rounded-md bg-code p-3 font-mono text-xs text-code-foreground">{spec.call(values)}</pre>
        </div>
      </CardContent>
      <CardFooter className="flex flex-wrap items-center gap-3 border-t">{footer}</CardFooter>
    </Card>
  );
  if (layout === 'inline') return card;
  if (layout === 'list') {
    return (
      <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-[15rem_minmax(0,1fr)]">
        <ExampleList examples={spec.examples} selected={selected} onPick={onPick} />
        {card}
      </div>
    );
  }
  return <div className="space-y-4"><ExampleGrid examples={spec.examples} selected={selected} onPick={onPick} />{card}</div>;
}
