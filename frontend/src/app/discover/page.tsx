import type { Metadata } from "next";
import { DiscoverWorkspace } from "@/components/discover/DiscoverWorkspace";

export const metadata: Metadata = {
  title: "Discover",
  description:
    "An autonomous agent discovers a marketplace of AI services, ranks them on capability, trust, price and latency, explains its choice, pays, and returns the answer.",
};

export default function DiscoverPage() {
  return <DiscoverWorkspace />;
}
