"use client";

import { clsx } from "clsx";

interface CardProps {
  children: React.ReactNode;
  className?: string;
  glow?: "violet" | "blue" | "cyan" | false;
  hover?: boolean;
}

export function Card({ children, className, glow = false, hover = true }: CardProps) {
  const glowMap = {
    violet: "hover:shadow-[0_0_40px_rgba(124,58,237,0.35)]",
    blue:   "hover:shadow-[0_0_40px_rgba(37,99,235,0.35)]",
    cyan:   "hover:shadow-[0_0_30px_rgba(6,182,212,0.25)]",
  };

  return (
    <div
      className={clsx(
        "glass-card rounded-2xl p-6 transition-all duration-300",
        hover && "hover:-translate-y-1",
        glow && glowMap[glow],
        className
      )}
    >
      {children}
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string | number;
  delta?: string;
  deltaPositive?: boolean;
  icon: React.ReactNode;
  accent?: "violet" | "blue" | "cyan" | "amber";
}

const accentMap = {
  violet: { icon: "bg-violet-500/15 text-violet-400", border: "border-violet-500/20" },
  blue:   { icon: "bg-blue-500/15   text-blue-400",   border: "border-blue-500/20"   },
  cyan:   { icon: "bg-cyan-500/15   text-cyan-400",   border: "border-cyan-500/20"   },
  amber:  { icon: "bg-amber-500/15  text-amber-400",  border: "border-amber-500/20"  },
};

export function StatCard({ label, value, delta, deltaPositive = true, icon, accent = "violet" }: StatCardProps) {
  const colors = accentMap[accent];
  return (
    <Card className={clsx("border", colors.border)}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-400 mb-2">{label}</p>
          <p className="stat-number gradient-text">{value}</p>
          {delta && (
            <p className={clsx("text-xs mt-2 font-medium", deltaPositive ? "text-emerald-400" : "text-red-400")}>
              {deltaPositive ? "↑" : "↓"} {delta}
            </p>
          )}
        </div>
        <div className={clsx("p-3 rounded-xl", colors.icon)}>
          {icon}
        </div>
      </div>
    </Card>
  );
}
