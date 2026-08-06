import { clsx, type ClassValue } from "clsx";

/** Conditional className joiner. */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

const compact = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatCount(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value < 10_000 ? value.toLocaleString("en") : compact.format(value);
}

export function formatXlm(value: number | null | undefined, digits = 4): string {
  if (value == null || Number.isNaN(value)) return "—";
  // Very small amounts would otherwise render as a misleading "0.0000".
  if (value > 0 && value < 10 ** -digits) return `<${(10 ** -digits).toFixed(digits)}`;
  return value.toFixed(digits);
}

export function formatUsd(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  if (value === 0) return "$0.00";
  if (value < 0.01) return `$${value.toPrecision(2)}`;
  return `$${value.toFixed(2)}`;
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 100 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["second", 60],
  ["minute", 60],
  ["hour", 24],
  ["day", 7],
  ["week", 4.35],
  ["month", 12],
  ["year", Number.POSITIVE_INFINITY],
];

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const timestamp = Date.parse(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`);
  if (Number.isNaN(timestamp)) return "—";

  let delta = (timestamp - Date.now()) / 1000;
  if (Math.abs(delta) < 10) return "just now";

  for (const [unit, step] of RELATIVE_UNITS) {
    if (Math.abs(delta) < step) return relative.format(Math.round(delta), unit);
    delta /= step;
  }
  return relative.format(Math.round(delta), "year");
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export function shortHash(hash: string, size = 6): string {
  return hash.length <= size * 2 + 1 ? hash : `${hash.slice(0, size)}…${hash.slice(-size)}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Deterministic 0–1 value from a string — for stable pseudo-random visuals. */
export function hashToUnit(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10_000) / 10_000;
}

export const isBrowser = typeof window !== "undefined";
