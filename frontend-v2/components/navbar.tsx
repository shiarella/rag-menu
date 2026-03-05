/**
 * Navbar — uses shadcn Button for all interactive elements so focus states,
 * keyboard navigation and ARIA are handled by Radix primitives.
 *
 * Colours come entirely from CSS variables (--primary, --primary-foreground)
 * so the whole brand can be changed by editing globals.css.
 */
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";

export default function Navbar() {
  return (
    <header className="bg-primary text-primary-foreground border-b border-white/10">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Left side: SBB logo (links to SBB site) + divider + app name (links to home) */}
        <div className="flex items-center gap-4 shrink-0">
          {/* SBB logo → external site */}
          <a
            href="https://staatsbibliothek-berlin.de"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Staatsbibliothek zu Berlin website"
          >
            <Image
              src="/SBB_Logo_White_DIN_A4.png"
              alt="Staatsbibliothek zu Berlin"
              width={160}
              height={44}
              className="h-11 w-auto"
              priority
            />
          </a>

          {/* Vertical divider */}
          <span
            className="hidden sm:block h-6 w-px bg-white/25"
            aria-hidden="true"
          />

          {/* App name → home */}
          <Link
            href="/"
            className="hidden sm:flex flex-col leading-tight group"
          >
            <span className="text-base font-semibold tracking-wide group-hover:text-white/90 transition-colors">
              Speisekarte
            </span>
            <span className="text-[10px] uppercase tracking-widest text-primary-foreground/50 group-hover:text-primary-foreground/70 transition-colors">
              Menu Card Search
            </span>
          </Link>
        </div>

        {/* Nav links */}
        <nav className="flex items-center gap-1" aria-label="Main navigation">
          <Button
            variant="ghost"
            asChild
            className="text-primary-foreground hover:text-primary-foreground hover:bg-white/10 focus-visible:ring-white/30"
          >
            <Link href="/">Search</Link>
          </Button>
          <Button
            variant="ghost"
            asChild
            className="text-primary-foreground hover:text-primary-foreground hover:bg-white/10 focus-visible:ring-white/30"
          >
            <Link href="/about">About</Link>
          </Button>
        </nav>
      </div>
    </header>
  );
}
