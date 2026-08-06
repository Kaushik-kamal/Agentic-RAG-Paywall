import type { Metadata } from "next";
import { Suspense } from "react";
import { ConsoleWorkspace } from "@/components/console/ConsoleWorkspace";
import { SkeletonText } from "@/components/ui/Feedback";

export const metadata: Metadata = {
  title: "Console",
  description:
    "Ask the knowledge base. Every answer streams in with chunk-level citations, a retrieval trace, and a confidence score.",
};

export default function ConsolePage() {
  return (
    <Suspense
      fallback={
        <div className="shell py-12">
          <SkeletonText lines={5} />
        </div>
      }
    >
      <ConsoleWorkspace />
    </Suspense>
  );
}
