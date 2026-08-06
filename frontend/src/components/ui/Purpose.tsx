import { cn } from "@/lib/utils";

/** One sentence explaining what a screen is for.
 *
 * Every major surface carries exactly one of these, in the same position and
 * the same voice, so a visitor landing anywhere in the product knows within a
 * second what they are looking at.
 */
export function Purpose({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p className={cn("purpose", className)}>
      <span aria-hidden className="text-[var(--accent-strong)]">
        ▸
      </span>
      {children}
    </p>
  );
}
