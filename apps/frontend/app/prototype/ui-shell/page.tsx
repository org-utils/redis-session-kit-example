// PROTOTYPE: three radically different UI shells for the showcase, switchable via ?variant=A|B|C,
// on a throwaway route. All data is stubbed in memory (see stub.ts); nothing talks to a backend.
'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { PrototypeSwitcher } from '@/components/prototype-switcher';
import { VariantA, name as nameA } from './variant-a';
import { VariantB, name as nameB } from './variant-b';
import { VariantC, name as nameC } from './variant-c';

const VARIANTS = [
  { key: 'A', name: nameA },
  { key: 'B', name: nameB },
  { key: 'C', name: nameC },
];

function Shell() {
  const variant = useSearchParams().get('variant') ?? 'A';
  return (
    <>
      {variant === 'A' && <VariantA />}
      {variant === 'B' && <VariantB />}
      {variant === 'C' && <VariantC />}
      <PrototypeSwitcher variants={VARIANTS} />
    </>
  );
}

export default function UiShellPrototype() {
  return (
    <Suspense>
      <Shell />
    </Suspense>
  );
}
