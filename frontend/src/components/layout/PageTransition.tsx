"use client";

import { usePathname } from "next/navigation";

/** Re-keys the subtree on navigation so each page replays the same short
 *  settle animation. No animation library, no layout shift — the CSS handles
 *  the motion and `prefers-reduced-motion` disables it globally. */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="page-enter">
      {children}
    </div>
  );
}
