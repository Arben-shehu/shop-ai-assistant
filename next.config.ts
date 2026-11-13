import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // cacheComponents left off: every page is per-user/per-shop, nothing worth prerendering.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
