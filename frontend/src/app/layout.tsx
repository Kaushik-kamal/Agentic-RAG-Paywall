import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Agentic RAG Paywall — AI Agents Pay to Know",
  description:
    "A platform where AI agents pay Stellar x402 micropayments to access a RAG-powered knowledge API. Built with Gemini, LangChain, ChromaDB, and FastAPI.",
  keywords: ["RAG", "AI agents", "Stellar", "x402", "micropayments", "LangChain", "Gemini"],
  openGraph: {
    title: "Agentic RAG Paywall",
    description: "AI agents pay Stellar micropayments to access knowledge.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <body className="min-h-full flex flex-col antialiased">
        <div className="mesh-bg" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}
