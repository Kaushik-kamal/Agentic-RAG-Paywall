"use client";

import Link from "next/link";
import { Code2, Waypoints } from "lucide-react";

import { useSession } from "@/components/providers/SessionProvider";
import { LiveDot } from "@/components/ui/Badge";
import { API_ORIGIN } from "@/lib/api";

const COLUMNS = [
  {
    heading: "Product",
    links: [
      { href: "/console", label: "Console" },
      { href: "/library", label: "Knowledge library" },
      { href: "/dashboard", label: "Analytics" },
    ],
  },
  {
    heading: "Protocol",
    links: [
      { href: "/protocol", label: "x402 walkthrough" },
      { href: "/protocol#integrate", label: "Integration guide" },
      { href: `${API_ORIGIN}/docs`, label: "OpenAPI reference", external: true },
    ],
  },
] as const;

export function Footer() {
  const { config, offline } = useSession();
  const network = config?.stellar.network ?? "testnet";

  return (
    <footer className="mt-24 border-t border-[color:var(--line)]">
      <div className="shell py-12">
        <div className="grid gap-10 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2 text-[0.9375rem] font-semibold">
              <Waypoints size={16} className="text-[var(--accent-strong)]" />
              Agentic RAG Paywall
            </div>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-[var(--text-muted)]">
              A knowledge API priced per answer. Agents discover the price from a
              402, settle on Stellar, and get a cited response.
            </p>
            <div className="mt-4 flex items-center gap-2 text-xs text-[var(--text-muted)]">
              <LiveDot tone={offline ? "danger" : "positive"} />
              {offline ? "API offline" : `Live on Stellar ${network}`}
            </div>
          </div>

          {COLUMNS.map((column) => (
            <div key={column.heading}>
              <p className="text-eyebrow mb-3">{column.heading}</p>
              <ul className="space-y-2.5 text-sm">
                {column.links.map((link) => (
                  <li key={link.href}>
                    {"external" in link && link.external ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div>
            <p className="text-eyebrow mb-3">Stack</p>
            <ul className="space-y-2.5 text-sm text-[var(--text-muted)]">
              <li>Next.js 16 · React 19</li>
              <li>FastAPI · Python 3.12</li>
              <li>{config?.models.generation ?? "Gemini"} · ChromaDB</li>
              <li>Stellar SDK · x402</li>
            </ul>
          </div>
        </div>

        <div className="hairline my-8" />

        <div className="flex flex-col items-center justify-between gap-4 text-xs text-[var(--text-faint)] sm:flex-row">
          <p>
            © {new Date().getFullYear()} Agentic RAG Paywall · MIT licensed
            {config ? ` · v${config.version}` : ""}
          </p>
          <a
            href="https://github.com/Kaushik-kamal/Agentic-RAG-Paywall"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 transition-colors hover:text-[var(--text)]"
          >
            <Code2 size={14} />
            Source
          </a>
        </div>
      </div>
    </footer>
  );
}
