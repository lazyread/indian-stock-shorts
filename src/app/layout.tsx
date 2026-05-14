import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Toaster } from 'sonner';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Indian Stock Shorts AI',
  description: 'Generate 60-second YouTube Shorts for Indian stocks automatically',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} antialiased`}>
        {children}
        <Toaster
          position="bottom-right"
          theme="dark"
          richColors
          closeButton
          toastOptions={{
            style: {
              background: 'hsl(222 47% 10%)',
              border: '1px solid hsl(222 47% 16%)',
              color: 'hsl(213 31% 91%)',
            },
          }}
        />
      </body>
    </html>
  );
}
