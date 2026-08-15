"use client";

/** The upgrade experience: shows the live 402 challenge and settles it.
 *
 * Two honest paths — an instant sandbox settlement for demos, and the real
 * on-chain instructions (address, exact amount, memo) for anyone with a
 * funded wallet. Nothing here pretends a payment happened that did not. */

import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Coins,
  ExternalLink,
  Landmark,
  Loader2,
  ShieldCheck,
  Sparkles,
  Wallet,
  X,
} from "lucide-react";

import { useSession, type PurchaseStage } from "@/components/providers/SessionProvider";
import { useToast } from "@/components/providers/ToastProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CodeBlock, CopyButton } from "@/components/ui/CodeBlock";
import { ApiError, getChallenge } from "@/lib/api";
import type { PaymentChallenge } from "@/lib/types";
import { cn, formatUsd, shortHash } from "@/lib/utils";

const STAGES: { id: PurchaseStage; label: string }[] = [
  { id: "challenge", label: "Requesting x402 challenge" },
  { id: "signing", label: "Signing the payment" },
  { id: "submitting", label: "Submitting to Stellar" },
  { id: "verifying", label: "Verifying on-chain" },
  { id: "settled", label: "Credits issued" },
];

/** The sandbox walks the same five stages, but three of them do something
 *  different: no key signs anything, nothing is submitted, and no ledger is
 *  read. Reusing the on-chain wording there would tell a visitor their wallet
 *  had just been charged, which is the one thing this dialog must never
 *  imply. */
const SANDBOX_STAGES: { id: PurchaseStage; label: string }[] = [
  { id: "challenge", label: "Requesting x402 challenge" },
  { id: "signing", label: "Issuing a sandbox reference — nothing is signed" },
  { id: "submitting", label: "No transaction sent — the chain is not touched" },
  { id: "verifying", label: "Recording the sandbox settlement" },
  { id: "settled", label: "Demo credits issued" },
];

export function PaywallDialog({
  open,
  onClose,
  reason,
}: {
  open: boolean;
  onClose: () => void;
  reason?: string;
}) {
  const { agentId, config, purchaseCredits, credits } = useSession();
  const { toast } = useToast();

  const [challenge, setChallenge] = useState<PaymentChallenge | null>(null);
  const [stage, setStage] = useState<PurchaseStage | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"instant" | "onchain">("instant");

  useEffect(() => {
    if (!open || !agentId) return;
    getChallenge(agentId).then(setChallenge).catch(() => setChallenge(null));
  }, [open, agentId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const settle = useCallback(async () => {
    setBusy(true);
    setStage("challenge");
    try {
      const result = await purchaseCredits({
        mode: "sandbox",
        onStage: (next) => setStage(next),
      });
      toast({
        tone: "success",
        title: `${result.credits_granted} credits added`,
        description: `Settled ${result.amount_xlm} XLM. Balance is now ${result.credits_remaining}.`,
      });
      setTimeout(onClose, 700);
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : "Payment could not be settled.";
      toast({ tone: "error", title: "Settlement failed", description: message });
      setStage(null);
    } finally {
      setBusy(false);
    }
  }, [onClose, purchaseCredits, toast]);

  if (!open) return null;

  const price = config?.pricing;
  const sandboxStages = tab === "instant";
  const stageList = sandboxStages ? SANDBOX_STAGES : STAGES;
  const stageIndex = stage ? stageList.findIndex((s) => s.id === stage) : -1;

  return (
    <div
      className="fixed inset-0 z-[85] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="paywall-title"
    >
      <div
        className="animate-fade absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={busy ? undefined : onClose}
        aria-hidden
      />

      <div className="panel-raised edge-lit animate-pop relative w-full max-w-lg overflow-hidden">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          aria-label="Close"
          className="absolute right-3 top-3 rounded p-1.5 text-[var(--text-faint)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:opacity-40"
        >
          <X size={16} />
        </button>

        <div className="border-b border-[color:var(--line)] p-6">
          <Badge tone="value" className="mb-3">
            <Coins size={11} />
            HTTP 402
          </Badge>
          <h2 id="paywall-title" className="text-heading">
            {credits > 0 ? "Top up query credits" : "Payment required"}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
            {reason ??
              "Each answer costs one credit. Settle an x402 payment on Stellar to continue — no account, no card, no subscription."}
          </p>

          {price ? (
            <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <Metric
                label="Price"
                value={`${price.price_xlm} XLM`}
                sub={formatUsd(price.price_usd)}
              />
              <Metric
                label="You receive"
                value={`${price.credits_per_payment} credits`}
                sub={`${price.price_per_credit_xlm.toFixed(6)} XLM each`}
              />
              <Metric
                label="Settlement"
                value={`~${price.settlement_seconds}s`}
                sub={price.network}
              />
            </div>
          ) : null}
        </div>

        <div className="flex gap-1 border-b border-[color:var(--line)] px-6 pt-3">
          <TabButton
            active={tab === "instant"}
            onClick={() => setTab("instant")}
            icon={<Sparkles size={13} />}
          >
            Instant demo
          </TabButton>
          <TabButton
            active={tab === "onchain"}
            onClick={() => setTab("onchain")}
            icon={<Wallet size={13} />}
          >
            Pay on-chain
          </TabButton>
        </div>

        <div className="p-6">
          {tab === "instant" ? (
            <>
              <div className="flex items-start gap-2.5 rounded-[var(--radius)] border border-[color:var(--positive)]/30 bg-[var(--positive-soft)] px-3.5 py-3">
                <ShieldCheck
                  size={15}
                  className="mt-0.5 shrink-0 text-[var(--positive)]"
                />
                <p className="text-sm leading-relaxed text-[var(--text)]">
                  <strong className="font-semibold">No real XLM is spent.</strong>{" "}
                  These are sandbox credits — no wallet is used, no key signs
                  anything, and nothing reaches the Stellar ledger.{" "}
                  <strong className="font-semibold">Pay on-chain</strong> is the only
                  tab that moves real funds.
                </p>
              </div>

              <p className="mt-3 text-sm leading-relaxed text-[var(--text-secondary)]">
                Credits are issued instantly so the product is explorable in one
                click. Sandbox settlement is enabled by configuration and is{" "}
                <strong>refused in production builds</strong>.
              </p>

              {stageIndex >= 0 ? (
                <ol className="mt-5 space-y-2">
                  {stageList.map((item, index) => {
                    const done = index < stageIndex;
                    const active = index === stageIndex;
                    return (
                      <li
                        key={item.id}
                        className={cn(
                          "flex items-center gap-2.5 text-sm transition-colors",
                          done
                            ? "text-[var(--positive)]"
                            : active
                              ? "text-[var(--text)]"
                              : "text-[var(--text-faint)]",
                        )}
                      >
                        {done ? (
                          <CheckCircle2 size={15} />
                        ) : active ? (
                          <Loader2 size={15} className="animate-spin" />
                        ) : (
                          <span className="h-[15px] w-[15px] rounded-full border border-current opacity-40" />
                        )}
                        {item.label}
                      </li>
                    );
                  })}
                </ol>
              ) : null}

              <Button
                variant="primary"
                size="lg"
                className="mt-6 w-full"
                loading={busy}
                onClick={settle}
                iconRight={busy ? undefined : <ArrowRight size={15} />}
              >
                {busy
                  ? "Issuing sandbox credits…"
                  : `Get ${price?.credits_per_payment ?? 10} sandbox credits · no XLM spent`}
              </Button>
            </>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start gap-2.5 rounded-[var(--radius)] border border-[color:var(--value)]/30 bg-[var(--value-soft)] px-3.5 py-3">
                <Wallet size={15} className="mt-0.5 shrink-0 text-[var(--value)]" />
                <p className="text-sm leading-relaxed text-[var(--text)]">
                  <strong className="font-semibold">
                    This path moves real funds.
                  </strong>{" "}
                  It needs a funded {challenge?.network ?? "testnet"} wallet and
                  settles on the public ledger. For a demo, use{" "}
                  <strong className="font-semibold">Instant demo</strong> instead.
                </p>
              </div>

              <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                Send the exact amount with the memo below, then verify the hash. The
                memo is what binds your payment to this challenge.
              </p>

              {challenge ? (
                <dl className="space-y-2 rounded-[var(--radius)] border border-[color:var(--line)] bg-[var(--surface-raised)] p-3 text-sm">
                  <Row label="Destination" value={challenge.destination} copy mono />
                  <Row label="Amount" value={`${challenge.amount_xlm} XLM`} />
                  <Row label="Memo" value={challenge.memo} copy mono />
                  <Row
                    label="Challenge"
                    value={shortHash(challenge.challenge_id, 8)}
                    mono
                  />
                </dl>
              ) : (
                <div className="skeleton h-28" />
              )}

              <p className="text-sm text-[var(--text-muted)]">
                Or let the reference agent do all of it — it creates a wallet, funds
                it from Friendbot, pays, and asks a question:
              </p>
              <CodeBlock
                filename="terminal"
                maxHeight="6rem"
                code={'cd backend\npython scripts/agent_client.py --stream "How does x402 work?"'}
              />

              {config?.stellar.configured ? (
                <a
                  href={`${config.stellar.explorer}/account/${challenge?.destination ?? ""}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-[var(--accent-strong)] hover:underline"
                >
                  <Landmark size={13} />
                  View the treasury account on Stellar Expert
                  <ExternalLink size={11} />
                </a>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-[0.6875rem] uppercase tracking-[0.08em] text-[var(--text-faint)]">
        {label}
      </p>
      <p className="text-numeric mt-0.5 font-semibold text-[var(--text)]">{value}</p>
      {sub ? <p className="text-xs text-[var(--text-muted)]">{sub}</p> : null}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 border-b-2 px-3 pb-2.5 text-sm font-medium transition-colors",
        active
          ? "border-[color:var(--accent)] text-[var(--text)]"
          : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function Row({
  label,
  value,
  copy,
  mono,
}: {
  label: string;
  value: string;
  copy?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="shrink-0 text-xs text-[var(--text-muted)]">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1">
        <span
          className={cn(
            "truncate text-[var(--text)]",
            mono && "mono text-[0.75rem]",
          )}
          title={value}
        >
          {mono && value.length > 24 ? shortHash(value, 10) : value}
        </span>
        {copy ? <CopyButton value={value} label="" /> : null}
      </dd>
    </div>
  );
}
