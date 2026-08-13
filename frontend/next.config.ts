import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Self-contained server bundle for the Docker runtime stage. Vercel builds
  // its own output format, so the option is dropped there.
  output: process.env.VERCEL ? undefined : "standalone",

  // Pin the workspace root so Turbopack does not walk up and find an unrelated
  // lockfile in a parent directory.
  turbopack: {
    root: path.resolve(process.cwd()),
  },

  // Icons are imported one-by-one across many files; this keeps the client
  // bundle to only the glyphs actually used.
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
