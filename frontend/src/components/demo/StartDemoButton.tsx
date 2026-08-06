"use client";

import { Play, Square } from "lucide-react";

import { useDemo } from "./DemoProvider";
import { Button } from "@/components/ui/Button";
import { Kbd } from "@/components/ui/Badge";

/** The one control a presenter needs. Everything else can be ignored. */
export function StartDemoButton({
  size = "md",
  showHint = false,
}: {
  size?: "sm" | "md" | "lg";
  showHint?: boolean;
}) {
  const { active, start, stop } = useDemo();

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        variant={active ? "secondary" : "primary"}
        size={size}
        onClick={active ? stop : start}
        icon={active ? <Square size={14} /> : <Play size={15} />}
      >
        {active ? "End demo" : "Start demo"}
      </Button>
      {showHint && !active ? (
        <span className="hidden items-center gap-1.5 text-xs text-[var(--text-faint)] sm:inline-flex">
          or press <Kbd>D</Kbd>
        </span>
      ) : null}
    </span>
  );
}
