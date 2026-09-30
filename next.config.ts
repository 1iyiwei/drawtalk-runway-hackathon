import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // With src/proxy.ts (password gate), Next buffers request bodies and truncates
    // them at 10MB by default; guide-video uploads (JPEG frames) can exceed that.
    proxyClientMaxBodySize: "200mb",
  },
};

export default nextConfig;
