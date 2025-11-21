import type { Metadata } from 'next';
import { ErrorBoundary } from '@/lib/components/ErrorBoundary';
import { SessionProvider } from '@/lib/components/auth/SessionProvider';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Dialogue Platform',
  description: 'Three AI minds collaborate to solve problems and analyze topics through dialogue',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <ErrorBoundary>
          <SessionProvider>{children}</SessionProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
