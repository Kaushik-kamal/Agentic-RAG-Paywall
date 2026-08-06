"use client";

/** A number that animates to its new value.
 *
 * Eased with a cubic ease-out so it decelerates into place rather than
 * stopping dead, and always rendered with tabular figures so the digits do not
 * jitter horizontally while counting. Honours `prefers-reduced-motion` by
 * snapping straight to the target.
 */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const EASE = (t: number) => 1 - (1 - t) ** 3;

export function useCountUp(target: number, durationMs = 900): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return;

    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      fromRef.current = target;
      // Snap on the next frame rather than synchronously, so the update is a
      // scheduled effect rather than a cascading render.
      frameRef.current = requestAnimationFrame(() => setValue(target));
      return () => cancelAnimationFrame(frameRef.current);
    }

    const started = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / durationMs);
      setValue(from + (target - from) * EASE(progress));
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [target, durationMs]);

  return value;
}

export function CountUp({
  value,
  decimals = 0,
  prefix = "",
  suffix = "",
  durationMs = 900,
  className,
}: {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  durationMs?: number;
  className?: string;
}) {
  const animated = useCountUp(value, durationMs);
  const display =
    decimals > 0
      ? animated.toFixed(decimals)
      : Math.round(animated).toLocaleString("en");

  return (
    <span className={cn("text-numeric tabular-nums", className)}>
      {prefix}
      {display}
      {suffix}
    </span>
  );
}
