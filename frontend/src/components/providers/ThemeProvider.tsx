"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";

export type ThemeChoice = "dark" | "light" | "system";
type Resolved = "dark" | "light";

const STORAGE_KEY = "argp.theme";

interface ThemeContextValue {
  theme: ThemeChoice;
  resolved: Resolved;
  setTheme: (theme: ThemeChoice) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** Runs before paint so the first frame is already the right theme.
 *  Inlined into <head> — keep it dependency-free and tiny. */
export const themeInitScript = `
(function(){
  try {
    var stored = localStorage.getItem("${STORAGE_KEY}");
    var prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
    var resolved = stored === "light" || stored === "dark"
      ? stored
      : (prefersLight ? "light" : "dark");
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
  } catch (e) {
    document.documentElement.dataset.theme = "dark";
  }
})();
`.trim();

/* ── External store ──────────────────────────────────────────────────────────
   The theme lives in the DOM and localStorage, not in React. `useSyncExternalStore`
   reads it during render instead of syncing it in with an effect, which keeps
   the first client render consistent with what the inline script already painted. */

const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const media = window.matchMedia("(prefers-color-scheme: light)");
  const onSystemChange = () => {
    if (readChoice() === "system") {
      applyTheme(media.matches ? "light" : "dark");
      emit();
    }
  };
  media.addEventListener("change", onSystemChange);
  window.addEventListener("storage", emit);

  return () => {
    listeners.delete(listener);
    media.removeEventListener("change", onSystemChange);
    window.removeEventListener("storage", emit);
  };
}

function readChoice(): ThemeChoice {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

function readResolved(): Resolved {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

/** Snapshots must be referentially stable or React re-renders forever. */
let snapshot = "system|dark";

function getSnapshot(): string {
  const next = `${readChoice()}|${readResolved()}`;
  if (next !== snapshot) snapshot = next;
  return snapshot;
}

function getServerSnapshot(): string {
  return "system|dark";
}

function applyTheme(resolved: Resolved): void {
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
}

function systemTheme(): Resolved {
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [theme, resolved] = state.split("|") as [ThemeChoice, Resolved];

  const setTheme = useCallback((next: ThemeChoice) => {
    if (next === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next === "system" ? systemTheme() : next);
    emit();
  }, []);

  const toggle = useCallback(() => {
    setTheme(readResolved() === "dark" ? "light" : "dark");
  }, [setTheme]);

  const value = useMemo(
    () => ({ theme, resolved, setTheme, toggle }),
    [theme, resolved, setTheme, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}
