"use client";

/** The one deploy mistake that breaks everything silently.
 *
 *  `NEXT_PUBLIC_API_URL` is inlined at build time. Ship without it and the
 *  bundle keeps its development default, so every panel on every page fails at
 *  once against the visitor's own machine — a site that looks deployed and
 *  works nowhere. This says so, instead of leaving a wall of empty states. */

import { useSyncExternalStore } from "react";
import { AlertTriangle } from "lucide-react";

import { API_BASE, apiPointsAtLocalhost } from "@/lib/api";

// The answer cannot change after hydration, so there is nothing to subscribe
// to — but reading it through the store keeps server and client renders in
// agreement instead of warning about a mismatch.
const subscribe = () => () => {};

export function ConfigNotice() {
  const misconfigured = useSyncExternalStore(
    subscribe,
    apiPointsAtLocalhost,
    () => false,
  );

  if (!misconfigured) return null;

  return (
    <div
      role="alert"
      className="flex items-start gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
    >
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <p className="leading-relaxed">
        <strong className="font-semibold">This deployment has no backend.</strong>{" "}
        The API URL is still <code className="font-mono">{API_BASE}</code>, which
        points at your own computer, not a server. Set{" "}
        <code className="font-mono">NEXT_PUBLIC_API_URL</code> in the hosting
        environment and redeploy — it is read at build time, so a restart alone
        will not pick it up.
      </p>
    </div>
  );
}
