import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Signal Loom",
  description: "Design the rig. Weave the signal.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <header className="border-b border-line bg-panel px-4 py-2 flex items-center gap-6">
          <Link href="/" className="font-semibold tracking-tight text-lg">
            Signal Loom
          </Link>
          <nav className="flex gap-4 text-sm" aria-label="Main">
            <Link href="/" className="hover:underline">Rigs</Link>
            <Link href="/catalog" className="hover:underline">Device library</Link>
          </nav>
          <span className="ml-auto text-xs text-neutral-500">Design the rig. Weave the signal.</span>
        </header>
        <main className="flex-1 flex flex-col">{children}</main>
      </body>
    </html>
  );
}
