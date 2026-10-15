// PROTOTYPE: floating variant switcher. Never ships: hidden in production builds.
'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

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
  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full bg-fuchsia-600 px-4 py-2 text-sm font-semibold text-white shadow-2xl ring-2 ring-white/40">
      <button onClick={() => go(-1)} aria-label="Previous variant">◀</button>
      <span>PROTOTYPE · {v.key} ({v.name})</span>
      <button onClick={() => go(1)} aria-label="Next variant">▶</button>
    </div>
  );
}
