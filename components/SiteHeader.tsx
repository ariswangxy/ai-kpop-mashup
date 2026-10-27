"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Studio" },
  { href: "/mashups", label: "My mashups" },
];

export function SiteHeader() {
  const pathname = usePathname();
  return (
    <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-5 sm:px-6">
      <Link href="/" className="flex items-center gap-2.5 font-display text-sm font-bold tracking-tight">
        <span aria-hidden className="flex h-7 w-7 items-end justify-center gap-[3px] rounded-lg bg-mashup p-1.5">
          <span className="h-2 w-[3px] rounded-full bg-on-accent" />
          <span className="h-3.5 w-[3px] rounded-full bg-on-accent" />
          <span className="h-2.5 w-[3px] rounded-full bg-on-accent" />
        </span>
        Mashup Studio
      </Link>
      <nav className="flex gap-1 rounded-full border border-line bg-surface/60 p-1 text-sm backdrop-blur">
        {links.map((l) => {
          const active = pathname === l.href;
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={`rounded-full px-3.5 py-1.5 transition-colors ${
                active ? "bg-fg text-bg" : "text-muted hover:text-fg"
              }`}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
