// PROTOTYPE: floating variant switcher. Never ships: hidden in production builds.
'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export function PrototypeSwitcher({ variants }: { variants: Array<{ key: string; name: string }> }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get('variant') ?? variants[0].key;
  const index = Math.max(0, variants.findIndex((v) => v.key === current));

  const go = (delta: number) => {
    const next = variants[(index + delta + variants.length) % variants.length];
    const sp = new URLSearchParams(params.toString());
    sp.set('variant', next.key);
    router.replace(`${pathname}?${sp.toString()}`);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (process.env.NODE_ENV === 'production') return null;
  const v = variants[index];
  // Deliberately loud (inverted foreground) so it never reads as part of the design.
  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-foreground p-1 text-background shadow-2xl">
      <Button variant="ghost" size="icon-sm" className="rounded-full hover:bg-background/20 hover:text-background" onClick={() => go(-1)} aria-label="Previous variant"><ChevronLeft /></Button>
      <Badge variant="outline" className="border-background/40 text-background">PROTOTYPE</Badge>
      <span className="px-2 text-sm font-medium">{v.key} · {v.name}</span>
      <Button variant="ghost" size="icon-sm" className="rounded-full hover:bg-background/20 hover:text-background" onClick={() => go(1)} aria-label="Next variant"><ChevronRight /></Button>
    </div>
  );
}
