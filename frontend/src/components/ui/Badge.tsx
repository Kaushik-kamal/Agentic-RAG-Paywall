"use client";

import { clsx } from "clsx";

interface BadgeProps {
  children: React.ReactNode;
  variant?: "violet" | "blue" | "cyan" | "green" | "amber" | "red";
  className?: string;
}

const variantMap: Record<string, string> = {
  violet: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  blue:   "bg-blue-500/15   text-blue-300   border-blue-500/30",
  cyan:   "bg-cyan-500/15   text-cyan-300   border-cyan-500/30",
  green:  "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  amber:  "bg-amber-500/15  text-amber-300  border-amber-500/30",
  red:    "bg-red-500/15    text-red-300    border-red-500/30",
};

export function Badge({ children, variant = "violet", className }: BadgeProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border tracking-wide uppercase",
        variantMap[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
