import './globals.css';
import type { ReactNode } from 'react';

export const metadata = { title: 'ioredis-toolkit showcase (prototype)' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans">{children}</body>
    </html>
  );
}
