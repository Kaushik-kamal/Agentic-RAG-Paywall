"use client";

/** Hand-rolled SVG charts.
 *
 * A charting library would be ~90 KB gzipped for two shapes. These render from
 * the same tokens as the rest of the UI, so they re-theme for free, and they
 * carry a text alternative for screen readers. */

import { useId, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

interface Point {
  label: string;
  value: number;
  secondary?: number;
}

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

export function AreaChart({
  data,
  height = 180,
  color = "var(--accent)",
  format = (v: number) => v.toLocaleString(),
  caption,
}: {
  data: Point[];
  height?: number;
  color?: string;
  format?: (value: number) => string;
  caption?: string;
}) {
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);

  const max = useMemo(
    () => niceMax(Math.max(...data.map((point) => point.value), 0)),
    [data],
  );

  if (!data.length) return null;

  const width = 100;
  const step = data.length > 1 ? width / (data.length - 1) : width;
  const y = (value: number) => 100 - (value / max) * 100;

  const line = data
    .map((point, index) => `${index === 0 ? "M" : "L"} ${index * step} ${y(point.value)}`)
    .join(" ");
  const area = `${line} L ${(data.length - 1) * step} 100 L 0 100 Z`;

  const active = hover === null ? null : data[hover];

  return (
    <figure className="relative">
      <svg
        viewBox={`0 0 ${width} 100`}
        preserveAspectRatio="none"
        style={{ height }}
        className="w-full overflow-visible"
        role="img"
        aria-label={
          caption ??
          `Trend from ${data[0].label} to ${data.at(-1)?.label}, peak ${format(max)}`
        }
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.32" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {[0, 25, 50, 75, 100].map((position) => (
          <line
            key={position}
            x1="0"
            x2={width}
            y1={position}
            y2={position}
            stroke="var(--line)"
            strokeWidth="0.4"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        <path d={area} fill={`url(#${gradientId})`} />
        <path
          d={line}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />

        {hover !== null ? (
          <>
            <line
              x1={hover * step}
              x2={hover * step}
              y1="0"
              y2="100"
              stroke={color}
              strokeWidth="1"
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
              opacity="0.6"
            />
            <circle
              cx={hover * step}
              cy={y(data[hover].value)}
              r="3"
              fill={color}
              stroke="var(--surface)"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          </>
        ) : null}

        {data.map((point, index) => (
          <rect
            key={point.label}
            x={index * step - step / 2}
            y="0"
            width={step}
            height="100"
            fill="transparent"
            onMouseEnter={() => setHover(index)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>

      {active ? (
        <div
          className="panel-raised pointer-events-none absolute -top-2 z-10 -translate-y-full px-2.5 py-1.5 text-xs"
          style={{
            left: `${((hover ?? 0) / Math.max(1, data.length - 1)) * 100}%`,
            transform: "translate(-50%, -100%)",
          }}
        >
          <p className="text-numeric font-semibold text-[var(--text)]">
            {format(active.value)}
          </p>
          <p className="text-[0.6875rem] text-[var(--text-muted)]">{active.label}</p>
        </div>
      ) : null}

      <figcaption className="mt-2 flex justify-between text-[0.625rem] text-[var(--text-faint)]">
        <span>{data[0].label}</span>
        <span>{data.at(-1)?.label}</span>
      </figcaption>
    </figure>
  );
}

export function BarChart({
  data,
  height = 150,
  color = "var(--data)",
  format = (v: number) => v.toLocaleString(),
}: {
  data: Point[];
  height?: number;
  color?: string;
  format?: (value: number) => string;
}) {
  const max = useMemo(
    () => niceMax(Math.max(...data.map((point) => point.value), 0)),
    [data],
  );
  const [hover, setHover] = useState<number | null>(null);

  if (!data.length) return null;

  return (
    <div>
      <div className="flex items-end gap-1" style={{ height }}>
        {data.map((point, index) => {
          const ratio = point.value / max;
          return (
            <div
              key={point.label}
              // h-full matters: `items-end` sizes children to content, so a
              // percentage-height bar inside an auto-height column collapses.
              className="group relative flex h-full flex-1 flex-col justify-end"
              onMouseEnter={() => setHover(index)}
              onMouseLeave={() => setHover(null)}
            >
              <div
                className={cn(
                  "w-full rounded-t-[3px] transition-all duration-500",
                  hover === index ? "opacity-100" : "opacity-75",
                )}
                style={{
                  height: `${Math.max(ratio * 100, point.value > 0 ? 3 : 1)}%`,
                  background:
                    point.value > 0
                      ? `linear-gradient(180deg, ${color}, color-mix(in oklab, ${color} 35%, transparent))`
                      : "var(--surface-active)",
                }}
              />
              {hover === index ? (
                <div className="panel-raised absolute -top-1 left-1/2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap px-2 py-1 text-[0.6875rem]">
                  <span className="text-numeric font-semibold text-[var(--text)]">
                    {format(point.value)}
                  </span>
                  <span className="ml-1.5 text-[var(--text-muted)]">{point.label}</span>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-[0.625rem] text-[var(--text-faint)]">
        <span>{data[0].label}</span>
        <span>{data.at(-1)?.label}</span>
      </div>
    </div>
  );
}

export function Sparkline({
  values,
  color = "var(--accent)",
  height = 28,
}: {
  values: number[];
  color?: string;
  height?: number;
}) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const step = 100 / (values.length - 1);
  const path = values
    .map((value, index) => `${index === 0 ? "M" : "L"} ${index * step} ${100 - (value / max) * 100}`)
    .join(" ");

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={{ height }}
      className="w-full"
      aria-hidden
    >
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
