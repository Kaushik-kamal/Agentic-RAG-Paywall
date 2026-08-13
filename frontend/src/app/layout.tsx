import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import Script from "next/script";

import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { PageTransition } from "@/components/layout/PageTransition";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { ConfigNotice } from "@/components/layout/ConfigNotice";
import { DemoOverlay } from "@/components/demo/DemoOverlay";
import { DemoProvider } from "@/components/demo/DemoProvider";
import { SessionProvider } from "@/components/providers/SessionProvider";
import { ThemeProvider, themeInitScript } from "@/components/providers/ThemeProvider";
import { ToastProvider } from "@/components/providers/ToastProvider";

import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono-code",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://agentic-rag-paywall.vercel.app"),
  title: {
    default: "Agentic RAG Paywall — a knowledge API that agents pay for",
    template: "%s · Agentic RAG Paywall",
  },
  description:
    "A pay-per-query knowledge API for autonomous agents. HTTP 402 challenges settle on Stellar in five seconds; answers come back grounded, cited, and scored for confidence.",
  keywords: [
    "x402",
    "Stellar",
    "micropayments",
    "RAG",
    "AI agents",
    "vector search",
    "Gemini",
    "agentic commerce",
  ],
  authors: [{ name: "Agentic RAG Paywall" }],
  openGraph: {
    type: "website",
    title: "Agentic RAG Paywall",
    description:
      "Autonomous agents pay 0.01 XLM per answer. Grounded retrieval, chunk-level citations, confidence scoring — settled on-chain in five seconds.",
    siteName: "Agentic RAG Paywall",
  },
  twitter: {
    card: "summary_large_image",
    title: "Agentic RAG Paywall",
    description: "A knowledge API that autonomous agents pay for, per answer.",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#07070c" },
    { media: "(prefers-color-scheme: light)", color: "#fbfbfd" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      data-theme="dark"
      // Next 16 no longer overrides scroll-behavior during navigation unless
      // this attribute is present, and globals.css sets smooth scrolling.
      data-scroll-behavior="smooth"
      className={`${inter.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <body className="flex min-h-dvh flex-col">
        {/* Applies the stored theme before hydration so there is no flash of
            the wrong palette. `beforeInteractive` injects it into <head>. */}
        <Script id="theme-init" strategy="beforeInteractive">
          {themeInitScript}
        </Script>

        <div className="ambient" aria-hidden />
        <div className="grid-veil" aria-hidden />

        <a href="#main" className="skip-link">
          Skip to content
        </a>

        <ThemeProvider>
          <ToastProvider>
            <SessionProvider>
              <DemoProvider>
                <ConfigNotice />
                <Navbar />
                {/* `key` on the route makes every navigation settle in the same
                    way, so the product reads as one surface rather than a set
                    of separate documents. */}
                <main id="main" className="flex-1">
                  <PageTransition>{children}</PageTransition>
                </main>
                <Footer />
                <CommandPalette />
                <DemoOverlay />
              </DemoProvider>
            </SessionProvider>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
