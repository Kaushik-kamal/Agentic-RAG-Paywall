"use client";

/**
 * Owns the browser's agent identity, its access token, and its credit balance.
 *
 * The browser is itself an x402 client: it holds an agent id, settles payments,
 * and spends credits exactly like an autonomous agent would. Keeping that logic
 * here means every page shares one balance and one token lifecycle.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import * as api from "@/lib/api";
import { ApiError } from "@/lib/api";
import type { PaymentChallenge, RuntimeConfig, VerifyResult } from "@/lib/types";

const AGENT_KEY = "argp.agent_id";
const TOKEN_KEY = "argp.access_token";
const TOKEN_EXPIRY_KEY = "argp.token_expires_at";
/** Refresh this many seconds before actual expiry to avoid a mid-request 401. */
const REFRESH_MARGIN = 90;

interface SessionValue {
  agentId: string | null;
  credits: number;
  totalQueries: number;
  totalSpentXlm: number;
  config: RuntimeConfig | null;
  ready: boolean;
  offline: boolean;
  /** Returns a token that is valid right now, minting one if needed. */
  getToken: () => Promise<string>;
  refresh: () => Promise<void>;
  /** Runs the full x402 loop and credits the account. */
  purchaseCredits: (options?: {
    mode?: "sandbox" | "live";
    onStage?: (stage: PurchaseStage, detail?: unknown) => void;
  }) => Promise<VerifyResult>;
  setCredits: (credits: number) => void;
}

export type PurchaseStage =
  | "challenge"
  | "signing"
  | "submitting"
  | "verifying"
  | "settled";

const SessionContext = createContext<SessionValue | null>(null);

function createAgentId(): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 10)
      : Math.random().toString(36).slice(2, 12);
  return `agent_web_${random}`;
}

/** The agent id lives in localStorage, which is unreadable during SSR.
 *  Exposing it as an external store lets the first client render see the real
 *  id instead of a placeholder that an effect corrects one frame later. */
function subscribeToIdentity(): () => void {
  // The id is created once and never changes for the lifetime of the tab.
  return () => {};
}

function readAgentId(): string {
  let id = localStorage.getItem(AGENT_KEY);
  if (!id) {
    id = createAgentId();
    localStorage.setItem(AGENT_KEY, id);
  }
  return id;
}

const noAgentOnServer = () => null;

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const agentId = useSyncExternalStore(
    subscribeToIdentity,
    readAgentId,
    noAgentOnServer,
  );

  const [credits, setCredits] = useState(0);
  const [totalQueries, setTotalQueries] = useState(0);
  const [totalSpentXlm, setTotalSpentXlm] = useState(0);
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [ready, setReady] = useState(false);
  const [offline, setOffline] = useState(false);

  const tokenRef = useRef<{ value: string; expiresAt: number } | null>(null);
  const inflight = useRef<Promise<string> | null>(null);

  // Restore a cached token so a reload does not need to mint a new one.
  useEffect(() => {
    const cached = localStorage.getItem(TOKEN_KEY);
    const expiry = Number(localStorage.getItem(TOKEN_EXPIRY_KEY) ?? 0);
    if (cached && expiry > Date.now() / 1000 + REFRESH_MARGIN) {
      tokenRef.current = { value: cached, expiresAt: expiry };
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!agentId) return;
    try {
      const balance = await api.getBalance(agentId);
      setCredits(balance.credits);
      setTotalQueries(balance.total_queries);
      setTotalSpentXlm(balance.total_spent_xlm);
      setOffline(false);
    } catch (error) {
      if (error instanceof ApiError && error.isNetworkFailure) setOffline(true);
    }
  }, [agentId]);

  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;

    // State lands only after the network settles.
    void (async () => {
      const [balance, runtime] = await Promise.allSettled([
        api.getBalance(agentId),
        api.getConfig(),
      ]);
      if (cancelled) return;

      if (balance.status === "fulfilled") {
        setCredits(balance.value.credits);
        setTotalQueries(balance.value.total_queries);
        setTotalSpentXlm(balance.value.total_spent_xlm);
        setOffline(false);
      } else if (
        balance.reason instanceof ApiError &&
        balance.reason.isNetworkFailure
      ) {
        setOffline(true);
      }

      if (runtime.status === "fulfilled") setConfig(runtime.value);
      setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [agentId]);

  // ── Token lifecycle ────────────────────────────────────────────────────────
  const getToken = useCallback(async (): Promise<string> => {
    if (!agentId) throw new ApiError(0, "no_agent", "Session is still initialising.");

    const current = tokenRef.current;
    if (current && current.expiresAt > Date.now() / 1000 + REFRESH_MARGIN) {
      return current.value;
    }
    // Collapse concurrent refreshes into one request.
    if (inflight.current) return inflight.current;

    inflight.current = (async () => {
      try {
        const minted = await api.mintToken(agentId);
        const expiresAt = Date.now() / 1000 + minted.expires_in;
        tokenRef.current = { value: minted.access_token, expiresAt };
        localStorage.setItem(TOKEN_KEY, minted.access_token);
        localStorage.setItem(TOKEN_EXPIRY_KEY, String(expiresAt));
        setCredits(minted.credits);
        return minted.access_token;
      } finally {
        inflight.current = null;
      }
    })();

    return inflight.current;
  }, [agentId]);

  // ── x402 purchase loop ─────────────────────────────────────────────────────
  const purchaseCredits = useCallback<SessionValue["purchaseCredits"]>(
    async ({ mode = "sandbox", onStage } = {}) => {
      if (!agentId) throw new ApiError(0, "no_agent", "Session is still initialising.");

      onStage?.("challenge");
      const challenge: PaymentChallenge = await api.getChallenge(agentId);
      onStage?.("challenge", challenge);

      onStage?.("signing", challenge);
      const transactionHash =
        mode === "sandbox"
          ? `sandbox_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
          : await settleOnChain(challenge);

      onStage?.("submitting", { transactionHash });
      onStage?.("verifying", { transactionHash });

      const result = await api.verifyPayment({
        transaction_hash: transactionHash,
        agent_id: agentId,
        challenge_id: challenge.challenge_id,
      });

      tokenRef.current = {
        value: result.access_token,
        expiresAt: Date.now() / 1000 + result.expires_in,
      };
      localStorage.setItem(TOKEN_KEY, result.access_token);
      localStorage.setItem(
        TOKEN_EXPIRY_KEY,
        String(Date.now() / 1000 + result.expires_in),
      );
      setCredits(result.credits_remaining);
      onStage?.("settled", result);
      return result;
    },
    [agentId],
  );

  const value = useMemo<SessionValue>(
    () => ({
      agentId,
      credits,
      totalQueries,
      totalSpentXlm,
      config,
      ready,
      offline,
      getToken,
      refresh,
      purchaseCredits,
      setCredits,
    }),
    [
      agentId,
      credits,
      totalQueries,
      totalSpentXlm,
      config,
      ready,
      offline,
      getToken,
      refresh,
      purchaseCredits,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/** Live settlement needs a funded wallet that can sign — out of scope for a
 *  browser without a wallet extension. The demo therefore surfaces a clear
 *  message rather than pretending a transaction happened. */
async function settleOnChain(challenge: PaymentChallenge): Promise<string> {
  throw new ApiError(
    501,
    "wallet_required",
    "Live settlement needs a funded Stellar wallet that can sign transactions. " +
      `Send ${challenge.amount_xlm} XLM to ${challenge.destination} with memo ` +
      `"${challenge.memo}", then verify the hash — or run the reference agent ` +
      "(backend/scripts/agent_client.py), which pays on-chain for real.",
    { challenge },
  );
}

export function useSession(): SessionValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used inside SessionProvider");
  return context;
}
