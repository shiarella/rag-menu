import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "content.staatsbibliothek-berlin.de",
      },
    ],
  },
};

export default nextConfig;
