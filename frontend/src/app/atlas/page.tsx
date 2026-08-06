import type { Metadata } from "next";
import { AtlasWorkspace } from "@/components/atlas/AtlasWorkspace";

export const metadata: Metadata = {
  title: "Corpus atlas",
  description:
    "A 2D map of the embedding space. Type a question and watch it land among the passages the retriever selects for it.",
};

export default function AtlasPage() {
  return <AtlasWorkspace />;
}
