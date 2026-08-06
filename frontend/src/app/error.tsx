"use client";

import { useEffect } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/Button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled UI error:", error);
  }, [error]);

  return (
    <div className="shell flex min-h-[60vh] flex-col items-center justify-center py-20 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-[var(--radius-lg)] border border-[color:var(--danger)]/30 bg-[var(--danger-soft)] text-[var(--danger)]">
        <TriangleAlert size={22} />
      </span>

      <h1 className="text-title mt-6">Something broke on this page</h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-[var(--text-muted)]">
        The error was logged to the console. Retrying often resolves it — if the
        API is restarting, give it a moment first.
      </p>

      {error.digest ? (
        <p className="mono mt-4 text-xs text-[var(--text-faint)]">
          digest {error.digest}
        </p>
      ) : null}

      <div className="mt-8 flex gap-3">
        <Button variant="primary" onClick={reset} icon={<RotateCcw size={15} />}>
          Try again
        </Button>
        <ButtonLink href="/">Back to home</ButtonLink>
      </div>
    </div>
  );
}
