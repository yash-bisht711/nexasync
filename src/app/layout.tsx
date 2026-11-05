import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'CollabSpace — Work together, in real time', description: 'A real-time collaborative workspace powered by Yjs.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
