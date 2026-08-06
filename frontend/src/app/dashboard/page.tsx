import type { Metadata } from "next";
import { DashboardWorkspace } from "@/components/dashboard/DashboardWorkspace";

export const metadata: Metadata = {
  title: "Analytics",
  description:
    "Live platform metrics: query volume, revenue settled on Stellar, retrieval latency, confidence distribution, and component health.",
};

export default function DashboardPage() {
  return <DashboardWorkspace />;
}
