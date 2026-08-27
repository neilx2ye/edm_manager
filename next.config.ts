import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@node-rs/argon2",
    "pg",
    "ws",
    "playwright",
    "playwright-core",
    "cheerio",
  ],
};

export default nextConfig;
