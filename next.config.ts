import type { NextConfig } from "next";

// Demo login credentials live in their own gitignored file. In a deployment, set the DEMO_* vars instead.
try {
  process.loadEnvFile(".env.demo-accounts.local");
} catch {}

const nextConfig: NextConfig = {};

export default nextConfig;
