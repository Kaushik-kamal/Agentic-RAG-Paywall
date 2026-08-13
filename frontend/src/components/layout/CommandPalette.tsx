"use client";

/** ⌘K palette. Navigates, toggles the theme, and runs a live semantic search
 *  across the knowledge base — the free retrieval endpoint makes this cheap. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Command as CommandIcon,
  Library,
  Loader2,
  MessagesSquare,
  Moon,
  Network,
  Search,
  Store,
  Sun,
  Waypoints,
} from "lucide-react";

import { useTheme } from "@/components/providers/ThemeProvider";
import { Kbd } from "@/components/ui/Badge";
import { API_ORIGIN, semanticSearch } from "@/lib/api";
import type { SearchMatch } from "@/lib/types";
import { cn, truncate } from "@/lib/utils";

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  group: string;
  run: () => void;
}

export function CommandPalette() {
  const router = useRouter();
  const { resolved, toggle } = useTheme();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [cursor, setCursor] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setMatches([]);
    setCursor(0);
  }, []);

  const navigationCommands = useMemo<Command[]>(
    () => [
      {
        id: "discover",
        label: "Discover — route a request autonomously",
        hint: "Let the agent find, evaluate and pay a provider",
        icon: <Network size={15} />,
        group: "Navigate",
        run: () => router.push("/discover"),
      },
      {
        id: "marketplace",
        label: "Provider marketplace",
        hint: "Every service on the discovery network",
        icon: <Store size={15} />,
        group: "Navigate",
        run: () => router.push("/marketplace"),
      },
      {
        id: "console",
        label: "Open the console",
        hint: "Ask the knowledge base",
        icon: <MessagesSquare size={15} />,
        group: "Navigate",
        run: () => router.push("/console"),
      },
      {
        id: "library",
        label: "Knowledge library",
        hint: "Upload and manage documents",
        icon: <Library size={15} />,
        group: "Navigate",
        run: () => router.push("/library"),
      },
      {
        id: "protocol",
        label: "x402 protocol walkthrough",
        hint: "Watch an agent pay for an answer",
        icon: <Waypoints size={15} />,
        group: "Navigate",
        run: () => router.push("/protocol"),
      },
      {
        id: "dashboard",
        label: "Analytics dashboard",
        icon: <BarChart3 size={15} />,
        group: "Navigate",
        run: () => router.push("/dashboard"),
      },
      {
        id: "docs",
        label: "OpenAPI reference",
        hint: "Interactive API docs",
        icon: <BookOpen size={15} />,
        group: "Navigate",
        run: () => window.open(`${API_ORIGIN}/docs`, "_blank"),
      },
      {
        id: "theme",
        label: resolved === "dark" ? "Switch to light theme" : "Switch to dark theme",
        icon: resolved === "dark" ? <Sun size={15} /> : <Moon size={15} />,
        group: "Preferences",
        run: toggle,
      },
    ],
    [resolved, router, toggle],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return navigationCommands;
    return navigationCommands.filter((command) =>
      `${command.label} ${command.hint ?? ""}`.toLowerCase().includes(needle),
    );
  }, [navigationCommands, query]);

  const totalItems = filtered.length + matches.length;

  // ── Global shortcut ────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      } else if (event.key === "Escape") {
        close();
      }
    };
    const onCustom = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("argp:command-palette", onCustom);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("argp:command-palette", onCustom);
    };
  }, [close]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  // ── Debounced semantic search ──────────────────────────────────────────────
  // Every state update happens inside the timer callback, never synchronously
  // in the effect body — that keeps typing to a single render per keystroke.
  useEffect(() => {
    const needle = query.trim();
    const controller = new AbortController();

    const timer = setTimeout(async () => {
      if (needle.length < 3) {
        setMatches([]);
        setSearching(false);
        return;
      }
      setSearching(true);
      try {
        const result = await semanticSearch({ query: needle, top_k: 5 });
        if (!controller.signal.aborted) setMatches(result.matches);
      } catch {
        if (!controller.signal.aborted) setMatches([]);
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 260);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  const activate = useCallback(
    (index: number) => {
      if (index < filtered.length) {
        filtered[index]?.run();
      } else {
        const match = matches[index - filtered.length];
        if (match) {
          router.push(`/console?q=${encodeURIComponent(query.trim())}`);
        }
      }
      close();
    },
    [close, filtered, matches, query, router],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((c) => (totalItems ? (c + 1) % totalItems : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((c) => (totalItems ? (c - 1 + totalItems) % totalItems : 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (totalItems) activate(cursor);
      else if (query.trim()) {
        router.push(`/console?q=${encodeURIComponent(query.trim())}`);
        close();
      }
    }
  };

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center px-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="animate-fade absolute inset-0 bg-black/55 backdrop-blur-sm"
        onClick={close}
        aria-hidden
      />

      <div className="panel-raised animate-pop relative w-full max-w-xl overflow-hidden">
        <div className="flex items-center gap-3 border-b border-[color:var(--line)] px-4">
          {searching ? (
            <Loader2 size={16} className="animate-spin text-[var(--accent-strong)]" />
          ) : (
            <Search size={16} className="text-[var(--text-faint)]" />
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setCursor(0); // reset selection alongside the edit, not after it
            }}
            onKeyDown={onKeyDown}
            placeholder="Search the knowledge base or jump to a page…"
            aria-label="Search"
            className="w-full bg-transparent py-3.5 text-[0.9375rem] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
          />
          <Kbd>esc</Kbd>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
          {filtered.length ? (
            <Group label={filtered[0].group}>
              {filtered.map((command, index) => (
                <Row
                  key={command.id}
                  index={index}
                  active={cursor === index}
                  onHover={setCursor}
                  onSelect={activate}
                  icon={command.icon}
                  title={command.label}
                  subtitle={command.hint}
                />
              ))}
            </Group>
          ) : null}

          {matches.length ? (
            <Group label={`Knowledge base · ${matches.length} passages`}>
              {matches.map((match, index) => (
                <Row
                  key={match.chunk_id}
                  index={filtered.length + index}
                  active={cursor === filtered.length + index}
                  onHover={setCursor}
                  onSelect={activate}
                  icon={
                    <span className="mono text-[0.6875rem] text-[var(--data)]">
                      {Math.round(match.score * 100)}
                    </span>
                  }
                  title={match.locator}
                  subtitle={truncate(match.text.replace(/\s+/g, " "), 96)}
                />
              ))}
            </Group>
          ) : null}

          {!filtered.length && !matches.length && !searching ? (
            <p className="px-3 py-8 text-center text-sm text-[var(--text-muted)]">
              {query.trim().length < 3
                ? "Type at least three characters to search the knowledge base."
                : "No matches. Press Enter to ask this as a question instead."}
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-4 border-t border-[color:var(--line)] px-4 py-2.5 text-[0.6875rem] text-[var(--text-faint)]">
          <span className="flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> navigate
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>↵</Kbd> select
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            <CommandIcon size={11} /> retrieval is free — generation costs a credit
          </span>
        </div>
      </div>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-1">
      <p className="px-3 py-1.5 text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-[var(--text-faint)]">
        {label}
      </p>
      {children}
    </div>
  );
}

function Row({
  index,
  active,
  onHover,
  onSelect,
  icon,
  title,
  subtitle,
}: {
  index: number;
  active: boolean;
  onHover: (index: number) => void;
  onSelect: (index: number) => void;
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <button
      type="button"
      data-index={index}
      onMouseEnter={() => onHover(index)}
      onClick={() => onSelect(index)}
      className={cn(
        "flex w-full items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2.5 text-left transition-colors",
        active ? "bg-[var(--surface-active)]" : "hover:bg-[var(--surface-hover)]",
      )}
    >
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[var(--surface)] text-[var(--text-muted)]">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-[var(--text)]">{title}</span>
        {subtitle ? (
          <span className="block truncate text-xs text-[var(--text-muted)]">
            {subtitle}
          </span>
        ) : null}
      </span>
      {active ? (
        <ArrowRight size={13} className="shrink-0 text-[var(--text-faint)]" />
      ) : null}
    </button>
  );
}
