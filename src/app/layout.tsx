import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { QueryProvider } from '@/lib/api/QueryProvider';
import { DatabaseProvider } from '@/lib/db/DatabaseProvider';
import './globals.css';

const inter = Inter({ variable: '--font-sans', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Real Estate Developer Platform',
  description: 'Admin Portal and Public Portal for a real estate developer.',
};

/**
 * Root layout is intentionally thin — each portal brings its own chrome:
 * src/app/admin/layout.tsx, src/app/(customer)/..., src/app/(public)/layout.tsx.
 *
 * `QueryProvider` is the cache every screen's `useApi` call reads through, so
 * it has to be outside all of them. `DatabaseProvider` is the interim Dexie
 * layer and goes when the last `useLiveQuery` does.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <body className="min-h-full">
        <QueryProvider>
          <DatabaseProvider>{children}</DatabaseProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
