"use client";

/** The presentation HUD.
 *
 * Sits above the real product rather than replacing it, so a judge watches the
 * actual application work while the overlay narrates. It never blocks pointer
 * events except during the boot card and the closing summary.
 */

import { useEffect, useState } from "react";
import {
  Bot,
  CheckCircle2,
  Coins,
  Layers,
  Network,
  Sparkles,
  X,
  XCircle,
} from "lucide-react";

import { useDemo, type DemoAgent } from "./DemoProvider";
import { accentColor } from "@/components/marketplace/ProviderCard";
import { Kbd } from "@/components/ui/Badge";
import { CountUp } from "@/components/ui/CountUp";
import { cn, formatDuration, truncate } from "@/lib/utils";

export function DemoOverlay() {
  const {
    active,
    phase,
    phaseIndex,
    phases,
    progress,
    elapsedMs,
    totalMs,
    agents,
    metrics,
    stop,
  } = useDemo();

  const [booting, setBooting] = useState(false);

  // The boot card is timed, not synchronous, so it never cascades a render.
  useEffect(() => {
    if (!active) return;
    const show = requestAnimationFrame(() => setBooting(true));
    const hide = setTimeout(() => setBooting(false), 2000);
    return () => {
      cancelAnimationFrame(show);
      clearTimeout(hide);
      setBooting(false);
    };
  }, [active]);

  if (!active) return null;

  const finished = phase.id === "summary";
  const succeeded = agents.filter((agent) => agent.status === "done");

  return (
    <>
      {/* ── Boot card ──────────────────────────────────────────────────────── */}
      {booting ? (
        <div className="animate-fade fixed inset-0 z-[95] grid place-items-center bg-[var(--canvas)]/92 backdrop-blur-md">
          <div className="animate-pop text-center">
            <div className="relative mx-auto h-16 w-16">
              <span className="absolute inset-0 rounded-2xl border border-[color:var(--line-accent)] bg-[var(--accent-soft)]" />
              <span
                className="absolute inset-0 rounded-2xl border-2 border-transparent border-t-[color:var(--accent)]"
                style={{ animation: "spin 1.1s linear infinite" }}
              />
              <Network
                size={24}
                className="absolute inset-0 m-auto text-[var(--accent-strong)]"
              />
            </div>
            <p className="mt-6 text-lg font-semibold tracking-tight text-[var(--text)]">
              Booting agent network
            </p>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              Connecting to the registry · funding the agent wallet
            </p>
            <div className="mx-auto mt-5 h-0.5 w-48 overflow-hidden rounded-full bg-[var(--surface-active)]">
              <div
                className="h-full rounded-full bg-[var(--accent)]"
                style={{ animation: "boot-fill 2s var(--ease-out) forwards" }}
              />
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Top rail: phase and progress ───────────────────────────────────── */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[92]">
        <div className="h-0.5 w-full bg-[var(--surface-active)]">
          <div
            className="h-full bg-gradient-to-r from-[var(--accent)] to-[var(--data)] transition-[width] duration-150 ease-linear"
            style={{ width: `${progress * 100}%` }}
          />
        </div>

        <div className="shell pt-3">
          <div className="glass animate-fade pointer-events-auto flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[var(--radius)] px-4 py-2.5">
            <span className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent)] opacity-70" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--accent)]" />
              </span>
              <span className="text-[0.625rem] font-semibold uppercase tracking-[0.12em] text-[var(--accent-strong)]">
                Demo
              </span>
            </span>

            <span className="mono text-[0.625rem] text-[var(--text-faint)]">
              {String(Math.min(phaseIndex + 1, phases.length)).padStart(2, "0")}/
              {String(phases.length).padStart(2, "0")}
            </span>

            <span className="min-w-0 flex-1" aria-live="polite" aria-atomic="true">
              <span className="block truncate text-[0.8125rem] font-medium text-[var(--text)]">
                {phase.label}
              </span>
              {phase.caption ? (
                <span className="block truncate text-[0.6875rem] text-[var(--text-muted)]">
                  {phase.caption}
                </span>
              ) : null}
            </span>

            <span className="mono hidden shrink-0 text-[0.625rem] text-[var(--text-faint)] sm:block">
              {formatDuration(elapsedMs)} / {formatDuration(totalMs)}
            </span>

            <button
              type="button"
              onClick={stop}
              className="shrink-0 rounded p-1 text-[var(--text-faint)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
              aria-label="End demo"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Side rail: agents and live metrics ─────────────────────────────── */}
      <aside
        className="animate-rise pointer-events-none fixed bottom-4 right-4 z-[92] hidden w-[21rem] lg:block"
        aria-live="polite"
      >
        <div className="glass pointer-events-auto overflow-hidden rounded-[var(--radius-lg)]">
          <div className="grid grid-cols-4 divide-x divide-[color:var(--line)] border-b border-[color:var(--line)]">
            <Metric
              icon={<Bot size={11} />}
              label="Agents"
              value={metrics.agents}
              tone="var(--accent)"
            />
            <Metric
              icon={<Layers size={11} />}
              label="Evals"
              value={metrics.evaluations}
              tone="var(--data)"
            />
            <Metric
              icon={<Coins size={11} />}
              label="Paid"
              value={metrics.payments}
              tone="var(--value)"
            />
            <Metric
              icon={<CheckCircle2 size={11} />}
              label="Done"
              value={metrics.transactions}
              tone="var(--positive)"
            />
          </div>

          <ul className="divide-y divide-[color:var(--line)]">
            {agents.map((agent) => (
              <li key={agent.id}>
                <AgentRow agent={agent} />
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-3 border-t border-[color:var(--line)] px-3 py-2 text-[0.625rem] text-[var(--text-faint)]">
            <span className="flex items-center gap-1">
              <Kbd>D</Kbd> toggle
            </span>
            <span className="flex items-center gap-1">
              <Kbd>esc</Kbd> end
            </span>
            <span className="ml-auto flex items-center gap-1 text-[var(--value)]">
              <Coins size={9} />
              <CountUp value={metrics.revenueXlm} decimals={4} suffix=" XLM" />
            </span>
          </div>
        </div>
      </aside>

      {/* ── Closing summary ────────────────────────────────────────────────── */}
      {finished ? (
        <div className="animate-fade fixed inset-0 z-[94] grid place-items-center bg-[var(--canvas)]/90 p-4 backdrop-blur-md">
          <div className="panel-raised edge-lit animate-pop success-glow relative w-full max-w-lg overflow-hidden p-8 text-center">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 -top-24 h-48 opacity-30 blur-3xl"
              style={{
                background:
                  "radial-gradient(ellipse at center, var(--accent), transparent 70%)",
              }}
            />
            <div className="relative">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-[var(--radius)] border border-[color:var(--positive)]/30 bg-[var(--positive-soft)] text-[var(--positive)]">
                <Sparkles size={20} />
              </span>

              <h2 className="mt-5 text-title">
                The economy <span className="text-gradient">ran itself</span>
              </h2>

              <dl className="mt-7 space-y-3 text-left">
                <Line
                  value={metrics.agents}
                  label="Autonomous agents"
                  tone="var(--accent)"
                />
                <Line
                  value={metrics.evaluations}
                  label="Provider evaluations"
                  tone="var(--data)"
                />
                <Line
                  value={metrics.payments}
                  label="Micropayments settled"
                  tone="var(--value)"
                />
                <Line
                  value={metrics.transactions}
                  label="Knowledge transactions"
                  tone="var(--positive)"
                />
                <Line value={0} label="Human interventions" tone="var(--text-muted)" />
              </dl>

              {succeeded.length ? (
                <p className="mt-6 text-xs leading-relaxed text-[var(--text-muted)]">
                  {new Set(succeeded.map((a) => a.provider)).size} different providers
                  chosen · {Math.round(metrics.avgConfidence)}% mean confidence ·{" "}
                  {formatDuration(totalMs)} end to end
                </p>
              ) : null}

              <button
                type="button"
                onClick={stop}
                className="btn btn-primary mt-7 w-full"
              >
                Back to the product
              </button>
              <p className="mt-3 text-[0.625rem] text-[var(--text-faint)]">
                Every figure above was produced by live API calls during this run.
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Metric({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className="px-2 py-2.5 text-center">
      <span
        className="flex items-center justify-center gap-1 text-[0.5625rem] font-semibold uppercase tracking-[0.08em]"
        style={{ color: tone }}
      >
        {icon}
        {label}
      </span>
      <CountUp
        value={value}
        className="mt-1 block text-base font-semibold leading-none text-[var(--text)]"
      />
    </div>
  );
}

function Line({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: string;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <CountUp
        value={value}
        durationMs={1100}
        className="w-12 shrink-0 text-right text-2xl font-semibold"
        // Colour carries the same meaning as elsewhere in the product.
      />
      <span className="text-sm text-[var(--text-secondary)]" style={{ color: tone }}>
        {label}
      </span>
    </div>
  );
}

const STATUS_LABEL: Record<DemoAgent["status"], string> = {
  idle: "queued",
  dispatched: "dispatched",
  evaluating: "evaluating",
  selected: "selected",
  paid: "paid",
  answering: "receiving",
  done: "complete",
  failed: "failed",
};

function AgentRow({ agent }: { agent: DemoAgent }) {
  const tone = agent.accent ? accentColor(agent.accent) : "var(--text-faint)";
  const done = agent.status === "done";
  const failed = agent.status === "failed";

  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <span className="shrink-0">
        {done ? (
          <CheckCircle2 size={12} className="text-[var(--positive)]" />
        ) : failed ? (
          <XCircle size={12} className="text-[var(--danger)]" />
        ) : agent.status === "idle" ? (
          <span className="block h-3 w-3 rounded-full border border-[color:var(--line-strong)]" />
        ) : (
          <span
            className="block h-2 w-2 rounded-full"
            style={{ background: tone, animation: "breathe 1.8s ease-in-out infinite" }}
          />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.6875rem] font-medium text-[var(--text)]">
          {agent.role}
        </span>
        <span
          className={cn(
            "block truncate text-[0.625rem]",
            agent.provider ? "" : "text-[var(--text-faint)]",
          )}
          style={agent.provider ? { color: tone } : undefined}
        >
          {agent.error ?? agent.provider ?? truncate(agent.task, 38)}
        </span>
      </span>

      <span className="shrink-0 text-right">
        <span className="mono block text-[0.5625rem] text-[var(--text-faint)]">
          {STATUS_LABEL[agent.status]}
        </span>
        <span className="mono block text-[0.5625rem]">
          {agent.status === "answering" ? (
            <span className="text-[var(--accent-strong)]">{agent.chars} ch</span>
          ) : agent.confidence ? (
            <span className="text-[var(--positive)]">{agent.confidence}%</span>
          ) : agent.evaluations ? (
            <span className="text-[var(--data)]">
              {agent.eligible ?? "—"}/{agent.evaluations}
            </span>
          ) : null}
        </span>
      </span>
    </div>
  );
}
