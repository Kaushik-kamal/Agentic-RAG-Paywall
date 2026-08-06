import type { Metadata } from "next";
import { LibraryWorkspace } from "@/components/library/LibraryWorkspace";

export const metadata: Metadata = {
  title: "Knowledge library",
  description:
    "Upload PDFs, DOCX, Markdown, text, CSV and JSON. Every file is parsed, chunked with heading awareness, embedded, and summarised.",
};

export default function LibraryPage() {
  return <LibraryWorkspace />;
}
