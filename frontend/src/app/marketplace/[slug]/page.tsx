import type { Metadata } from "next";
import { ProviderDetailWorkspace } from "@/components/marketplace/ProviderDetailWorkspace";

export const metadata: Metadata = {
  title: "Provider",
  description:
    "Full service listing: capabilities, pricing, payment terms, knowledge scope, and a reputation history replayed from real transactions.",
};

// Next.js 16: route params are async.
export default async function ProviderPage(props: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await props.params;
  return <ProviderDetailWorkspace slug={slug} />;
}
