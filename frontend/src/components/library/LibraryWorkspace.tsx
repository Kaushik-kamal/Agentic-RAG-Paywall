"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  FileCode2,
  FileSpreadsheet,
  FileText,
  FileType2,
  Hash,
  Layers,
  Loader2,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import { useToast } from "@/components/providers/ToastProvider";
import { Badge, Chip } from "@/components/ui/Badge";
import { Button, IconButton } from "@/components/ui/Button";
import { Card, SectionHeader, StatTile } from "@/components/ui/Card";
import { EmptyState, OfflineBanner, Skeleton } from "@/components/ui/Feedback";
import { Purpose } from "@/components/ui/Purpose";
import { ApiError, deleteDocument, listDocuments, uploadDocument } from "@/lib/api";
import type { DocumentLibrary, KnowledgeDocument } from "@/lib/types";
import { cn, formatBytes, formatCount, formatRelative } from "@/lib/utils";

const ICONS: Record<string, typeof FileText> = {
  pdf: FileType2,
  docx: FileText,
  csv: FileSpreadsheet,
  json: FileCode2,
  md: FileText,
  txt: FileText,
};

function iconFor(filename: string) {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  return ICONS[extension] ?? FileText;
}

interface UploadJob {
  id: string;
  name: string;
  size: number;
  state: "uploading" | "done" | "error";
  message?: string;
}

export function LibraryWorkspace() {
  const { toast } = useToast();

  const [library, setLibrary] = useState<DocumentLibrary | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const load = useCallback(async () => {
    try {
      setLibrary(await listDocuments());
      setOffline(false);
    } catch (error) {
      if (error instanceof ApiError && (error.status === 502 || error.isNetworkFailure)) {
        setOffline(true);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // `load` only updates state after awaiting the network; the rule cannot
    // see through the async boundary.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const ingest = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (!list.length) return;

      const maxBytes = (library?.max_upload_mb ?? 25) * 1024 * 1024;

      for (const file of list) {
        const id = `${file.name}-${Date.now()}-${Math.random()}`;
        setJobs((current) => [
          ...current,
          { id, name: file.name, size: file.size, state: "uploading" },
        ]);

        if (file.size > maxBytes) {
          setJobs((current) =>
            current.map((job) =>
              job.id === id
                ? {
                    ...job,
                    state: "error",
                    message: `Exceeds the ${library?.max_upload_mb ?? 25} MB limit`,
                  }
                : job,
            ),
          );
          continue;
        }

        try {
          const result = await uploadDocument(file);
          setJobs((current) =>
            current.map((job) =>
              job.id === id ? { ...job, state: "done", message: result.message } : job,
            ),
          );
          toast({
            tone: result.duplicate ? "info" : "success",
            title: result.duplicate ? "Already indexed" : "Document indexed",
            description: result.message,
          });
          await load();
        } catch (error) {
          const message =
            error instanceof ApiError ? error.message : "Upload failed.";
          setJobs((current) =>
            current.map((job) =>
              job.id === id ? { ...job, state: "error", message } : job,
            ),
          );
          toast({ tone: "error", title: `Could not index ${file.name}`, description: message });
        }
      }

      // Clear finished jobs after the user has had time to read them.
      setTimeout(
        () => setJobs((current) => current.filter((job) => job.state === "uploading")),
        6000,
      );
    },
    [library?.max_upload_mb, load, toast],
  );

  const remove = useCallback(
    async (document: KnowledgeDocument) => {
      try {
        await deleteDocument(document.document_id);
        setLibrary((current) =>
          current
            ? {
                ...current,
                documents: current.documents.filter(
                  (item) => item.document_id !== document.document_id,
                ),
                total_documents: current.total_documents - 1,
                total_chunks: current.total_chunks - document.chunk_count,
              }
            : current,
        );
        toast({
          tone: "success",
          title: "Document removed",
          description: `${document.title} and its ${document.chunk_count} vectors were deleted.`,
        });
      } catch (error) {
        toast({
          tone: "error",
          title: "Delete failed",
          description: error instanceof ApiError ? error.message : "Unknown error.",
        });
      }
    },
    [toast],
  );

  const documents = (library?.documents ?? []).filter((document) => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return true;
    return `${document.title} ${document.filename} ${document.topics.join(" ")} ${document.summary ?? ""}`
      .toLowerCase()
      .includes(needle);
  });

  return (
    <div className="shell py-10">
      <SectionHeader
        eyebrow="Knowledge base"
        title="Library"
        description="Everything the API can answer from. Files are parsed, split along heading structure, embedded with Gemini, and summarised on ingest."
        actions={
          <Button
            variant="primary"
            icon={<Upload size={15} />}
            onClick={() => inputRef.current?.click()}
          >
            Upload
          </Button>
        }
      />

      <Purpose className="mt-4">
        The knowledge each provider sells — parsed, chunked, embedded and scoped.
      </Purpose>

      {offline ? <OfflineBanner className="mt-6" /> : null}

      <div className="stagger mt-6 grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Documents"
          value={formatCount(library?.total_documents ?? 0)}
          icon={<FileText size={16} />}
          loading={loading}
        />
        <StatTile
          label="Indexed chunks"
          value={formatCount(library?.total_chunks ?? 0)}
          sublabel="retrievable passages"
          icon={<Layers size={16} />}
          accent="data"
          loading={loading}
        />
        <StatTile
          label="Characters"
          value={formatCount(library?.total_characters ?? 0)}
          sublabel="total corpus size"
          icon={<Hash size={16} />}
          accent="value"
          loading={loading}
        />
      </div>

      {/* ── Dropzone ──────────────────────────────────────────────────────── */}
      <div
        onDragEnter={(event) => {
          event.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          event.preventDefault();
          dragDepth.current -= 1;
          if (dragDepth.current <= 0) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          ingest(event.dataTransfer.files);
        }}
        className={cn(
          "mt-4 rounded-[var(--radius-lg)] border-2 border-dashed p-8 text-center transition-all duration-200",
          dragging
            ? "scale-[1.01] border-[color:var(--accent)] bg-[var(--accent-soft)]"
            : "border-[color:var(--line-strong)] bg-[var(--surface)]",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={library?.supported_extensions.join(",") ?? ".pdf,.docx,.txt,.md,.csv,.json"}
          className="sr-only"
          onChange={(event) => {
            if (event.target.files) ingest(event.target.files);
            event.target.value = "";
          }}
        />

        <div
          className={cn(
            "mx-auto grid h-12 w-12 place-items-center rounded-[var(--radius)] border border-[color:var(--line)] transition-transform duration-300",
            dragging ? "scale-110 bg-[var(--accent)] text-white" : "bg-[var(--surface-raised)] text-[var(--accent-strong)]",
          )}
        >
          <Upload size={20} />
        </div>

        <p className="mt-3 text-sm font-medium text-[var(--text)]">
          {dragging ? "Drop to index" : "Drag files here, or click Upload"}
        </p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          {(library?.supported_extensions ?? [".pdf", ".docx", ".txt", ".md"]).join(" · ")}
          {" — up to "}
          {library?.max_upload_mb ?? 25} MB each
        </p>
      </div>

      {jobs.length ? (
        <ul className="mt-3 space-y-2">
          {jobs.map((job) => (
            <li
              key={job.id}
              className="animate-rise flex items-center gap-3 rounded-[var(--radius)] border border-[color:var(--line)] bg-[var(--surface-raised)] px-3.5 py-2.5"
            >
              {job.state === "uploading" ? (
                <Loader2 size={15} className="animate-spin text-[var(--accent-strong)]" />
              ) : job.state === "done" ? (
                <CheckCircle2 size={15} className="text-[var(--positive)]" />
              ) : (
                <X size={15} className="text-[var(--danger)]" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-[var(--text)]">{job.name}</p>
                <p className="truncate text-xs text-[var(--text-muted)]">
                  {job.message ?? `${formatBytes(job.size)} · parsing, chunking, embedding…`}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {/* ── Document list ─────────────────────────────────────────────────── */}
      <div className="mt-8">
        <div className="mb-4 flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]"
            />
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter by title, topic, or summary…"
              aria-label="Filter documents"
              className="field pl-10 text-sm"
            />
          </div>
          <span className="text-xs text-[var(--text-muted)]">
            {documents.length} of {library?.documents.length ?? 0}
          </span>
        </div>

        {loading ? (
          <div className="grid gap-3 md:grid-cols-2">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-36" />
            ))}
          </div>
        ) : documents.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Sparkles size={22} />}
              title={
                library?.documents.length
                  ? "No documents match that filter"
                  : "The knowledge base is empty"
              }
              description={
                library?.documents.length
                  ? "Try a different search term."
                  : "Upload a document above, or seed the bundled demo corpus with `python scripts/seed_demo.py` in the backend directory."
              }
            />
          </Card>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {documents.map((document) => {
              const Icon = iconFor(document.filename);
              const open = expanded === document.document_id;
              return (
                <li key={document.document_id}>
                  <Card interactive className="h-full">
                    <div className="flex items-start gap-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-[var(--accent-soft)] text-[var(--accent-strong)]">
                        <Icon size={16} />
                      </span>

                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-sm font-medium text-[var(--text)]">
                          {document.title}
                        </h3>
                        <p className="mt-0.5 truncate text-xs text-[var(--text-faint)]">
                          {document.filename} · {formatBytes(document.size_bytes)} ·{" "}
                          {formatRelative(document.created_at)}
                        </p>
                      </div>

                      <IconButton
                        label={`Delete ${document.title}`}
                        onClick={() => remove(document)}
                        icon={<Trash2 size={14} />}
                        className="hover:text-[var(--danger)]"
                      />
                    </div>

                    {document.summary ? (
                      <p
                        className={cn(
                          "mt-3 text-[0.8125rem] leading-relaxed text-[var(--text-muted)]",
                          !open && "line-clamp-2",
                        )}
                      >
                        {document.summary}
                      </p>
                    ) : (
                      <p className="mt-3 text-[0.8125rem] italic text-[var(--text-faint)]">
                        No AI summary — the model was unavailable during ingest.
                      </p>
                    )}

                    {document.topics.length ? (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {document.topics.slice(0, open ? 99 : 4).map((topic) => (
                          <Chip
                            key={topic}
                            onClick={() => setFilter(topic)}
                            className="text-[0.6875rem]"
                          >
                            {topic}
                          </Chip>
                        ))}
                      </div>
                    ) : null}

                    <div className="mt-4 flex items-center justify-between gap-2 border-t border-[color:var(--line)] pt-3">
                      <div className="flex items-center gap-2">
                        <Badge tone="data">{document.chunk_count} chunks</Badge>
                        {document.page_count ? (
                          <Badge tone="neutral">{document.page_count} pages</Badge>
                        ) : null}
                      </div>
                      {document.summary || document.topics.length > 4 ? (
                        <button
                          type="button"
                          onClick={() =>
                            setExpanded(open ? null : document.document_id)
                          }
                          className="text-xs text-[var(--accent-strong)] hover:underline"
                        >
                          {open ? "Less" : "More"}
                        </button>
                      ) : null}
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
