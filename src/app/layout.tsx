import type { Metadata } from 'next';
import { ErrorBoundary } from '@/lib/components/ErrorBoundary';
import { SessionProvider } from '@/lib/components/auth/SessionProvider';
import { Toaster } from 'react-hot-toast';
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
          <SessionProvider>
            {children}
            <Toaster
              position="top-right"
              toastOptions={{
                duration: 3000,
                style: {
                  background: '#000',
                  color: '#fff',
                  border: '2px solid #22c55e',
                  borderRadius: '8px',
                },
                success: {
                  iconTheme: {
                    primary: '#22c55e',
                    secondary: '#000',
                  },
                },
                error: {
                  iconTheme: {
                    primary: '#ef4444',
                    secondary: '#000',
                  },
                },
              }}
            />
          </SessionProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
