import type { Metadata } from "next";
import { ProtocolWorkspace } from "@/components/protocol/ProtocolWorkspace";

export const metadata: Metadata = {
  title: "x402 protocol",
  description:
    "Watch an autonomous agent hit a 402, settle a Stellar micropayment, and buy an answer — with every request and response shown verbatim.",
};

export default function ProtocolPage() {
  return <ProtocolWorkspace />;
}
