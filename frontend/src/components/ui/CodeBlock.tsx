"use client";

import { useCallback, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

export function CopyButton({
  value,
  label = "Copy",
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard is unavailable over plain HTTP on some browsers; fall back.
      const area = document.createElement("textarea");
      area.value = value;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.append(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }, [value]);

  return (
    <button
      type="button"
      onClick={copy}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1 text-xs font-medium",
        "text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
        className,
      )}
    >
      {copied ? (
        <Check size={12} className="text-[var(--positive)]" />
      ) : (
        <Copy size={12} />
      )}
      {copied ? "Copied" : label}
    </button>
  );
}

export function CodeBlock({
  code,
  filename,
  language,
  className,
  maxHeight = "26rem",
}: {
  code: string;
  filename?: string;
  language?: string;
  className?: string;
  maxHeight?: string;
}) {
  return (
    <figure
      className={cn(
        "overflow-hidden rounded-[var(--radius)] border border-[color:var(--line)] bg-[var(--surface)]",
        className,
      )}
    >
      <figcaption className="flex items-center justify-between gap-2 border-b border-[color:var(--line)] bg-[var(--surface-raised)] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex gap-1.5" aria-hidden>
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--danger)] opacity-60" />
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--value)] opacity-60" />
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--positive)] opacity-60" />
          </span>
          <span className="mono truncate text-[var(--text-muted)]">
            {filename ?? language ?? "snippet"}
          </span>
        </div>
        <CopyButton value={code} />
      </figcaption>
      <pre
        className="mono overflow-auto p-4 leading-[1.65] text-[var(--text-secondary)]"
        style={{ maxHeight }}
      >
        <code>{code}</code>
      </pre>
    </figure>
  );
}
