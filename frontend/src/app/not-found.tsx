import { Compass } from "lucide-react";
import { ButtonLink } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <div className="shell flex min-h-[60vh] flex-col items-center justify-center py-20 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-[var(--radius-lg)] border border-[color:var(--line)] bg-[var(--surface-raised)] text-[var(--accent-strong)]">
        <Compass size={22} />
      </span>

      <p className="mono mt-6 text-sm text-[var(--text-faint)]">404</p>
      <h1 className="text-title mt-2">No route here</h1>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-[var(--text-muted)]">
        This page does not exist. The console, library, protocol walkthrough and
        analytics are all one click away.
      </p>

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <ButtonLink href="/console" variant="primary">
          Open the console
        </ButtonLink>
        <ButtonLink href="/">Back to home</ButtonLink>
      </div>
    </div>
  );
}
