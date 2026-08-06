"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastTone = "success" | "error" | "warning" | "info";

interface Toast {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  duration: number;
}

interface ToastContextValue {
  toast: (input: Omit<Toast, "id" | "duration"> & { duration?: number }) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_META: Record<
  ToastTone,
  { icon: typeof Info; color: string; ring: string }
> = {
  success: {
    icon: CheckCircle2,
    color: "text-[var(--positive)]",
    ring: "border-[color:var(--positive)]/35",
  },
  error: {
    icon: XCircle,
    color: "text-[var(--danger)]",
    ring: "border-[color:var(--danger)]/35",
  },
  warning: {
    icon: AlertTriangle,
    color: "text-[var(--value)]",
    ring: "border-[color:var(--value)]/35",
  },
  info: {
    icon: Info,
    color: "text-[var(--accent-strong)]",
    ring: "border-[color:var(--accent)]/35",
  },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback<ToastContextValue["toast"]>(
    ({ duration = 5200, ...input }) => {
      const id = Math.random().toString(36).slice(2, 10);
      setToasts((current) => [...current.slice(-3), { ...input, id, duration }]);
      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
        role="region"
        aria-label="Notifications"
      >
        {toasts.map((item) => {
          const meta = TONE_META[item.tone];
          const Icon = meta.icon;
          return (
            <div
              key={item.id}
              role="status"
              aria-live="polite"
              className={cn(
                "pointer-events-auto animate-pop panel-raised flex items-start gap-3 p-3.5",
                meta.ring,
              )}
            >
              <Icon size={17} className={cn("mt-0.5 shrink-0", meta.color)} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[var(--text)]">{item.title}</p>
                {item.description ? (
                  <p className="mt-1 text-[0.8125rem] leading-relaxed text-[var(--text-muted)]">
                    {item.description}
                  </p>
                ) : null}
                {item.action ? (
                  <button
                    type="button"
                    onClick={() => {
                      item.action?.onClick();
                      dismiss(item.id);
                    }}
                    className="mt-2 text-[0.8125rem] font-medium text-[var(--accent-strong)] hover:underline"
                  >
                    {item.action.label}
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                aria-label="Dismiss notification"
                className="-m-1 rounded p-1 text-[var(--text-faint)] transition-colors hover:text-[var(--text)]"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}
