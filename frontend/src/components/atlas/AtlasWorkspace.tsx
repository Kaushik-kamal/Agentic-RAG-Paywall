"use client";

/** The corpus atlas.
 *
 * Every indexed chunk is a 3072-dimensional vector — unviewable. PCA finds the
 * two directions the corpus varies along most and projects onto them. Because
 * the projection is linear, a *query* can be placed in the same basis, so the
 * overlay shows where a question actually lands relative to its answers.
 *
 * This is the retrieval story made visible: passages about one idea cluster,
 * and the retriever picks the neighbours of the query, not keyword matches.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Compass,
  Crosshair,
  Layers,
  Loader2,
  Search,
  Sparkles,
  Target,
} from "lucide-react";

import { Badge, Chip } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, SectionHeader } from "@/components/ui/Card";
import { EmptyState, OfflineBanner, Skeleton } from "@/components/ui/Feedback";
import { Purpose } from "@/components/ui/Purpose";
import { useDemo } from "@/components/demo/DemoProvider";
import { ApiError, getAtlas, projectIntoAtlas } from "@/lib/api";
import type { Atlas, AtlasPoint, AtlasProjection } from "@/lib/types";
import { cn, formatDuration, truncate } from "@/lib/utils";

/** Distinct hues per document — chosen for separation in both themes. */
const PALETTE = [
  "var(--accent)",
  "var(--data)",
  "var(--value)",
  "var(--positive)",
  "#f472b6",
  "#a3e635",
  "#38bdf8",
  "#fb923c",
];

const EXAMPLES = [
  "how fast does a ledger close",
  "preventing double-spend of a receipt",
  "what makes a chunk retrievable",
  "why agents cannot use credit cards",
];

const VIEW = 1000;
const PAD = 60;

export function AtlasWorkspace() {
  const [atlas, setAtlas] = useState<Atlas | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  const [query, setQuery] = useState("");
  const [projection, setProjection] = useState<AtlasProjection | null>(null);
  const [projecting, setProjecting] = useState(false);

  const [hovered, setHovered] = useState<AtlasPoint | null>(null);
  const [focusedDocument, setFocusedDocument] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const { atlasQuery } = useDemo();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await getAtlas();
        if (!cancelled) {
          setAtlas(result);
          setOffline(false);
        }
      } catch (error) {
        if (!cancelled && error instanceof ApiError && error.isNetworkFailure) {
          setOffline(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const colorFor = useMemo(() => {
    const order = new Map(
      (atlas?.documents ?? []).map((document, index) => [
        document.document_id,
        PALETTE[index % PALETTE.length],
      ]),
    );
    return (documentId: string) => order.get(documentId) ?? "var(--text-faint)";
  }, [atlas?.documents]);

  const project = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || projecting) return;
      setProjecting(true);
      try {
        setProjection(await projectIntoAtlas(text, 6));
      } catch {
        setProjection(null);
      } finally {
        setProjecting(false);
      }
    },
    [projecting],
  );

  // Demo mode drives the atlas: when the director reaches the retrieval phase
  // it publishes a query, and this projects it exactly as a visitor would.
  useEffect(() => {
    if (!atlasQuery || !atlas?.available) return;
    const timer = setTimeout(() => {
      setQuery(atlasQuery);
      void project(atlasQuery);
    }, 350);
    return () => clearTimeout(timer);
    // `project` changes on every render; depending on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atlasQuery, atlas?.available]);

  // Map normalised [-1, 1] coordinates into the SVG viewBox.
  const toView = useCallback(
    (value: number) => PAD + ((value + 1) / 2) * (VIEW - PAD * 2),
    [],
  );

  const retrievedIds = useMemo(
    () => new Set((projection?.retrieved ?? []).map((item) => item.chunk_id)),
    [projection],
  );

  const points = atlas?.points ?? [];

  return (
    <div className="shell py-10">
      <SectionHeader
        eyebrow="Embedding space"
        title={
          <>
            The corpus, <span className="text-gradient">as the retriever sees it</span>
          </>
        }
        description="Every chunk is a 3072-dimensional vector. This projects them onto their two principal components — and because that projection is linear, a live query lands in exactly the same space."
        actions={
          atlas?.available ? (
            <Badge tone="neutral">
              <Layers size={11} />
              {points.length} chunks · {atlas.dimensions}D → 2D
            </Badge>
          ) : null
        }
      />

      <Purpose className="mt-4">
        Visualising the semantic relationships between documents and the queries that
        retrieve them.
      </Purpose>

      {offline ? <OfflineBanner className="mt-6" /> : null}

      {/* ── Query bar ─────────────────────────────────────────────────────── */}
      <div className="mt-6">
        <div className="relative">
          <Search
            size={15}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]"
          />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && project(query)}
            placeholder="Type a question and watch where it lands…"
            aria-label="Project a query into the atlas"
            className="field py-3 pl-10 pr-28"
            disabled={!atlas?.available}
          />
          <Button
            size="sm"
            variant="primary"
            className="absolute right-2 top-1/2 -translate-y-1/2"
            loading={projecting}
            disabled={!query.trim() || !atlas?.available}
            onClick={() => project(query)}
            icon={projecting ? undefined : <Crosshair size={13} />}
          >
            Project
          </Button>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--text-faint)]">Try:</span>
          {EXAMPLES.map((example) => (
            <Chip
              key={example}
              onClick={() => {
                setQuery(example);
                void project(example);
              }}
            >
              {example}
            </Chip>
          ))}
          <span className="ml-auto text-xs text-[var(--text-faint)]">
            Retrieval-only — costs nothing
          </span>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_19rem]">
        {/* ── Plot ────────────────────────────────────────────────────────── */}
        <Card padded={false} className="relative overflow-hidden">
          {loading ? (
            <Skeleton className="aspect-[4/3] w-full" />
          ) : !atlas?.available ? (
            <EmptyState
              icon={<Compass size={22} />}
              title="Not enough indexed text yet"
              description={atlas?.reason}
            />
          ) : (
            <>
              <svg
                viewBox={`0 0 ${VIEW} ${VIEW}`}
                className="aspect-square w-full"
                role="img"
                aria-label={`Scatter plot of ${points.length} document chunks projected into two dimensions`}
              >
                <defs>
                  <radialGradient id="query-halo">
                    <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.45" />
                    <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
                  </radialGradient>
                </defs>

                {/* Grid */}
                {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
                  <g key={fraction} stroke="var(--line)" strokeWidth="1">
                    <line
                      x1={PAD + fraction * (VIEW - PAD * 2)}
                      x2={PAD + fraction * (VIEW - PAD * 2)}
                      y1={PAD}
                      y2={VIEW - PAD}
                    />
                    <line
                      x1={PAD}
                      x2={VIEW - PAD}
                      y1={PAD + fraction * (VIEW - PAD * 2)}
                      y2={PAD + fraction * (VIEW - PAD * 2)}
                    />
                  </g>
                ))}

                {/* Lines from the query to what retrieval selected */}
                {projection?.available
                  ? points
                      .filter((point) => retrievedIds.has(point.chunk_id))
                      .map((point) => (
                        <line
                          key={`link-${point.chunk_id}`}
                          x1={toView(projection.x)}
                          y1={toView(-projection.y)}
                          x2={toView(point.x)}
                          y2={toView(-point.y)}
                          stroke="var(--accent)"
                          strokeWidth="1.5"
                          strokeOpacity="0.45"
                          strokeDasharray="6 4"
                        />
                      ))
                  : null}

                {/* Chunks */}
                {points.map((point) => {
                  const retrieved = retrievedIds.has(point.chunk_id);
                  const dimmed =
                    (focusedDocument && point.document_id !== focusedDocument) ||
                    (projection?.available && !retrieved);
                  return (
                    <circle
                      key={point.chunk_id}
                      cx={toView(point.x)}
                      cy={toView(-point.y)}
                      r={retrieved ? 13 : 8}
                      fill={colorFor(point.document_id)}
                      fillOpacity={dimmed ? 0.18 : 0.85}
                      stroke={retrieved ? "var(--accent)" : "transparent"}
                      strokeWidth="3"
                      className="cursor-pointer transition-all duration-300"
                      onMouseEnter={() => setHovered(point)}
                      onMouseLeave={() => setHovered(null)}
                    >
                      <title>{point.section || point.document_title}</title>
                    </circle>
                  );
                })}

                {/* Query marker */}
                {projection?.available ? (
                  <g>
                    <circle
                      cx={toView(projection.x)}
                      cy={toView(-projection.y)}
                      r="52"
                      fill="url(#query-halo)"
                    />
                    <circle
                      cx={toView(projection.x)}
                      cy={toView(-projection.y)}
                      r="11"
                      fill="var(--accent)"
                      stroke="var(--surface)"
                      strokeWidth="4"
                    />
                  </g>
                ) : null}
              </svg>

              {/* Hover card */}
              {hovered ? (
                <div className="panel-raised pointer-events-none absolute bottom-3 left-3 right-3 p-3">
                  <p className="flex items-center gap-2 text-xs font-medium text-[var(--text)]">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: colorFor(hovered.document_id) }}
                    />
                    {hovered.section || hovered.document_title}
                  </p>
                  <p className="mt-1 text-[0.6875rem] leading-relaxed text-[var(--text-muted)]">
                    {truncate(hovered.preview.replace(/\s+/g, " "), 190)}
                  </p>
                </div>
              ) : null}

              {projecting ? (
                <div className="absolute inset-0 grid place-items-center bg-[var(--canvas)]/40 backdrop-blur-[1px]">
                  <Loader2 size={22} className="animate-spin text-[var(--accent-strong)]" />
                </div>
              ) : null}
            </>
          )}
        </Card>

        {/* ── Side panel ──────────────────────────────────────────────────── */}
        <div className="space-y-4">
          <Card>
            <h3 className="text-sm font-semibold">Documents</h3>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Click to isolate a source
            </p>
            <ul className="mt-3 space-y-1.5">
              {(atlas?.documents ?? []).map((document) => (
                <li key={document.document_id}>
                  <button
                    type="button"
                    onClick={() =>
                      setFocusedDocument(
                        focusedDocument === document.document_id
                          ? null
                          : document.document_id,
                      )
                    }
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-left transition-colors",
                      focusedDocument === document.document_id
                        ? "bg-[var(--surface-active)]"
                        : "hover:bg-[var(--surface-hover)]",
                    )}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: colorFor(document.document_id) }}
                    />
                    <span className="min-w-0 flex-1 truncate text-xs text-[var(--text-secondary)]">
                      {document.title}
                    </span>
                    <span className="mono shrink-0 text-[0.625rem] text-[var(--text-faint)]">
                      {document.chunks}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          {projection?.available ? (
            <Card className="animate-rise">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Target size={14} className="text-[var(--accent-strong)]" />
                Nearest neighbours
              </h3>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                {projection.retrieved.length} passages selected in{" "}
                {formatDuration(projection.latency_ms)}
              </p>
              <ol className="mt-3 space-y-2">
                {projection.retrieved.map((item, index) => (
                  <li
                    key={item.chunk_id}
                    className="rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[var(--surface-raised)] p-2"
                  >
                    <div className="flex items-start gap-2">
                      <span className="mono mt-px shrink-0 rounded bg-[var(--accent)] px-1 text-[0.625rem] text-white">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[0.6875rem] font-medium text-[var(--text)]">
                          {item.locator}
                        </p>
                        <p className="mono mt-0.5 text-[0.625rem] text-[var(--data)]">
                          {Math.round(item.score * 100)}% similar
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </Card>
          ) : (
            <Card>
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Sparkles size={14} className="text-[var(--accent-strong)]" />
                How to read this
              </h3>
              <ul className="mt-3 space-y-2.5 text-xs leading-relaxed text-[var(--text-muted)]">
                <li>
                  Each dot is one indexed passage. Colour is its source document.
                </li>
                <li>
                  Proximity is semantic: passages that mean similar things sit
                  together, even with no words in common.
                </li>
                <li>
                  Project a query and it appears as a glowing marker, linked to
                  the passages the retriever chose.
                </li>
              </ul>
            </Card>
          )}

          <Card>
            <h3 className="text-sm font-semibold">Projection</h3>
            <ul className="mt-3 space-y-2 text-xs">
              <Row label="Method" value="PCA · 2 components" />
              <Row
                label="Variance kept"
                value={`${Math.round((atlas?.total_variance_explained ?? 0) * 100)}%`}
              />
              <Row
                label="PC1 / PC2"
                value={(atlas?.explained_variance ?? [])
                  .map((v) => `${Math.round(v * 100)}%`)
                  .join(" / ")}
              />
              <Row label="Source dimensions" value={String(atlas?.dimensions ?? "—")} />
            </ul>
            <p className="mt-3 text-[0.6875rem] leading-relaxed text-[var(--text-faint)]">
              PCA is linear, so new queries project into the same basis. t-SNE and
              UMAP look tidier but cannot place a new point without refitting —
              which would make this overlay a lie.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="text-[var(--text-muted)]">{label}</span>
      <span className="mono text-[0.6875rem] text-[var(--text)]">{value}</span>
    </li>
  );
}
