"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./Button";

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={cn("animate-spin", className)} aria-hidden />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} aria-hidden />;
}

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2.5" aria-hidden>
      {Array.from({ length: lines }, (_, index) => (
        <div
          key={index}
          className="skeleton h-3.5"
          style={{ width: `${100 - index * 9 - (index === lines - 1 ? 25 : 0)}%` }}
        />
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-6 py-14 text-center",
        className,
      )}
    >
      {icon ? (
        <div className="relative mb-5">
          <div
            aria-hidden
            className="absolute inset-0 -z-10 rounded-full bg-[var(--accent)] opacity-15 blur-2xl"
          />
          <div className="grid h-14 w-14 place-items-center rounded-[var(--radius-lg)] border border-[color:var(--line)] bg-[var(--surface-raised)] text-[var(--accent-strong)]">
            {icon}
          </div>
        </div>
      ) : null}
      <p className="text-base font-medium text-[var(--text)]">{title}</p>
      {description ? (
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-[var(--text-muted)]">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  className,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-3 rounded-[var(--radius)] border border-[color:var(--danger)]/30 bg-[var(--danger-soft)] p-4",
        className,
      )}
    >
      <AlertCircle size={17} className="mt-0.5 shrink-0 text-[var(--danger)]" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-[var(--text)]">{title}</p>
        <p className="mt-1 text-[0.8125rem] leading-relaxed text-[var(--text-secondary)]">
          {message}
        </p>
      </div>
      {onRetry ? (
        <Button size="sm" variant="ghost" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export function OfflineBanner({ className }: { className?: string }) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[var(--radius)] border border-[color:var(--value)]/30 bg-[var(--value-soft)] px-4 py-3 text-[0.8125rem]",
        className,
      )}
    >
      <AlertCircle size={15} className="shrink-0 text-[var(--value)]" />
      <span className="text-[var(--text)]">API unreachable.</span>
      <span className="text-[var(--text-muted)]">
        Start the backend with
      </span>
      <code className="mono rounded bg-[var(--surface-active)] px-1.5 py-0.5 text-[var(--data)]">
        uvicorn app.main:app --reload --port 8000
      </code>
    </div>
  );
}
