import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

// Runs before first paint so a saved Dark choice never flashes Light. Storage failures fall back to Light.
const THEME_INIT = `try{if(localStorage.getItem("signal-loom-theme")==="dark")document.documentElement.dataset.theme="dark"}catch(e){}`;

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Signal Loom",
  description: "Design the rig. Weave the signal.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_INIT }} /></head>
      <body className="min-h-full flex flex-col">
        <header className="border-b border-line bg-panel px-3 sm:px-4 py-2 flex items-center gap-4 sm:gap-6">
          <Link href="/" className="font-semibold tracking-tight text-lg whitespace-nowrap">
            Signal Loom
          </Link>
          {/* Three links no longer fit beside the brand at 390 px with nowrap (nav right edge landed at 391 px),
              so the nav wraps onto a second row on phones; each label stays on one line and nothing is hidden. */}
          <nav className="flex flex-wrap gap-x-3 gap-y-0.5 sm:gap-4 text-sm min-w-0" aria-label="Main">
            <Link href="/" className="hover:underline whitespace-nowrap">Rigs</Link>
            <Link href="/catalog" className="hover:underline whitespace-nowrap">Device library</Link>
            <Link href="/morningstar" className="hover:underline whitespace-nowrap">Morningstar Bridge</Link>
          </nav>
          <span className="ml-auto text-xs text-neutral-500 hidden md:inline">Design the rig. Weave the signal.</span>
          <ThemeToggle />
        </header>
        <main className="flex-1 flex flex-col">{children}</main>
      </body>
    </html>
  );
}
