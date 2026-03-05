import type { NextConfig } from "next";

// In production the API runs as a Docker sidecar.
// NEXT_PUBLIC_API is set at build time; API_INTERNAL_URL is the server-side
// rewrite destination (container-to-container, never exposed to the browser).
const API_INTERNAL = process.env.API_INTERNAL_URL ?? "http://api:8000";

const nextConfig: NextConfig = {
  // Standalone output bundles only what's needed — keeps the Docker image small
  output: "standalone",
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "content.staatsbibliothek-berlin.de",
      },
    ],
  },
  // Proxy /api/* → FastAPI so the browser only ever talks to port 3000.
  // This means NEXT_PUBLIC_API can simply be "" (empty) in production and
  // all fetch("/api/search") calls will just work.
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_INTERNAL}/:path*`,
      },
    ];
  },
};

export default nextConfig;
