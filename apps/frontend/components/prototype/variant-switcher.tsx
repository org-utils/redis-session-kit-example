// PROTOTYPE (throwaway): the floating bar that flips between prototype variants via ?variant=. Never shown in production.
'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

export function useVariant(keys: string[]): string {
  const v = useSearchParams().get('variant');
  return v && keys.includes(v) ? v : keys[0];
}

export function VariantSwitcher({ variants }: { variants: { key: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = useVariant(variants.map((v) => v.key));
  const i = variants.findIndex((v) => v.key === current);

  const go = (d: number) => {
    const next = new URLSearchParams(params);
    next.set('variant', variants[(i + d + variants.length) % variants.length].key);
    router.replace(`${pathname}?${next}`, { scroll: false });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.closest('input, textarea, select, [contenteditable], [role=combobox], [role=listbox]'))) return;
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (process.env.NODE_ENV === 'production') return null;
  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-foreground px-1.5 py-1 text-background shadow-lg">
      <Button size="icon-sm" variant="ghost" className="rounded-full hover:bg-background/20 hover:text-background" onClick={() => go(-1)} aria-label="Previous variant"><ChevronLeft /></Button>
      <span className="px-2 font-mono text-xs">PROTOTYPE · {current} ({variants[i].name})</span>
      <Button size="icon-sm" variant="ghost" className="rounded-full hover:bg-background/20 hover:text-background" onClick={() => go(1)} aria-label="Next variant"><ChevronRight /></Button>
    </div>
  );
}
