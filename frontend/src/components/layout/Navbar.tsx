"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  BarChart3,
  Coins,
  Command,
  Library,
  Menu,
  MessagesSquare,
  Moon,
  Sun,
  Waypoints,
  X,
} from "lucide-react";

import { Badge, Kbd } from "@/components/ui/Badge";
import { IconButton } from "@/components/ui/Button";
import { useSession } from "@/components/providers/SessionProvider";
import { useTheme } from "@/components/providers/ThemeProvider";
import { cn, formatCount } from "@/lib/utils";

const LINKS = [
  { href: "/console", label: "Console", icon: MessagesSquare },
  { href: "/library", label: "Library", icon: Library },
  { href: "/protocol", label: "Protocol", icon: Waypoints },
  { href: "/dashboard", label: "Analytics", icon: BarChart3 },
] as const;

/** Scroll position is browser state, not React state — reading it through an
 *  external store avoids a mount-time setState and an extra render. */
function subscribeToScroll(onChange: () => void): () => void {
  window.addEventListener("scroll", onChange, { passive: true });
  return () => window.removeEventListener("scroll", onChange);
}

const isScrolled = () => window.scrollY > 8;
const notScrolledOnServer = () => false;

export function Navbar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { credits, ready } = useSession();
  const { resolved, toggle } = useTheme();

  const scrolled = useSyncExternalStore(
    subscribeToScroll,
    isScrolled,
    notScrolledOnServer,
  );

  // Close the mobile menu whenever the route changes. This is a deliberate
  // sync-with-navigation update, which is exactly what the effect is for.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setOpen(false), [pathname]);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 transition-all duration-300",
        scrolled ? "glass border-b border-[color:var(--line)]" : "border-b border-transparent",
      )}
    >
      <nav
        className="shell flex items-center justify-between"
        style={{ height: "var(--nav-height)" }}
        aria-label="Primary"
      >
        <Link
          href="/"
          className="group flex shrink-0 items-center gap-2.5"
          aria-label="Agentic RAG Paywall — home"
        >
          <Mark />
          <span className="hidden text-[0.9375rem] font-semibold tracking-tight sm:block">
            Agentic<span className="text-[var(--text-muted)]">RAG</span>
          </span>
        </Link>

        <ul className="hidden items-center gap-0.5 md:flex">
          {LINKS.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex items-center gap-2 rounded-[var(--radius-sm)] px-3 py-2 text-[0.8125rem] font-medium transition-colors duration-150",
                    active
                      ? "text-[var(--text)]"
                      : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
                  )}
                >
                  <Icon size={14} />
                  {label}
                  {active ? (
                    <span
                      aria-hidden
                      className="absolute inset-x-3 -bottom-px h-px bg-[var(--accent)]"
                    />
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center gap-1.5">
          <Link
            href="/console"
            title="Query credits remaining"
            className="hidden items-center gap-1.5 sm:flex"
          >
            <Badge tone={credits > 0 ? "value" : "danger"}>
              <Coins size={11} />
              {ready ? formatCount(credits) : "—"}
              <span className="hidden lg:inline">credits</span>
            </Badge>
          </Link>

          <button
            type="button"
            onClick={() =>
              window.dispatchEvent(new CustomEvent("argp:command-palette"))
            }
            className={cn(
              "hidden items-center gap-2 rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[var(--surface-raised)] px-2.5 py-1.5 lg:flex",
              "text-[0.8125rem] text-[var(--text-muted)] transition-colors hover:border-[color:var(--line-strong)] hover:text-[var(--text)]",
            )}
          >
            <Command size={13} />
            <span>Search</span>
            <Kbd>⌘K</Kbd>
          </button>

          <IconButton
            label={resolved === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            onClick={toggle}
            icon={resolved === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          />

          <IconButton
            label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            className="md:hidden"
            onClick={() => setOpen((value) => !value)}
            icon={open ? <X size={17} /> : <Menu size={17} />}
          />
        </div>
      </nav>

      {open ? (
        <div className="glass animate-fade border-t border-[color:var(--line)] md:hidden">
          <ul className="shell flex flex-col gap-1 py-3">
            {LINKS.map(({ href, label, icon: Icon }) => (
              <li key={href}>
                <Link
                  href={href}
                  className={cn(
                    "flex items-center gap-3 rounded-[var(--radius)] px-3 py-2.5 text-sm font-medium transition-colors",
                    pathname === href
                      ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]",
                  )}
                >
                  <Icon size={16} />
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </header>
  );
}

/** Wordmark: three stacked bars that read as both documents and a ledger. */
function Mark() {
  return (
    <span className="relative grid h-8 w-8 place-items-center overflow-hidden rounded-[0.6rem] border border-[color:var(--line-accent)] bg-[var(--accent-soft)]">
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4 text-[var(--accent-strong)] transition-transform duration-500 group-hover:rotate-180"
        fill="none"
        aria-hidden
      >
        <path
          d="M4 7h16M4 12h10M4 17h13"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx="19" cy="16.5" r="3" stroke="currentColor" strokeWidth="2" />
      </svg>
    </span>
  );
}
