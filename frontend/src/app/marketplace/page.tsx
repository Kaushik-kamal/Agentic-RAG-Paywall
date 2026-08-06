import type { Metadata } from "next";
import { MarketplaceWorkspace } from "@/components/marketplace/MarketplaceWorkspace";

export const metadata: Metadata = {
  title: "Marketplace",
  description:
    "Every AI service on the discovery network, with live price, latency, reputation and capability metadata that agents read before they buy.",
};

export default function MarketplacePage() {
  return <MarketplaceWorkspace />;
}
