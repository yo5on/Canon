import type { NextConfig } from "next";

// Demo login credentials live in their own gitignored file. In a deployment, set the DEMO_* vars instead.
try {
  process.loadEnvFile(".env.demo-accounts.local");
} catch {}

const nextConfig: NextConfig = {
  // Native / WASM extraction libraries are loaded from node_modules at runtime instead of being bundled.
  serverExternalPackages: ["tesseract.js", "tesseract.js-core", "sharp", "unpdf", "mammoth"],
  // OCR runs offline: ship the English model and the tesseract worker + WASM with the upload function.
  outputFileTracingIncludes: {
    "/api/items/from-file": [
      "./node_modules/@tesseract.js-data/eng/4.0.0_best_int/**",
      "./node_modules/tesseract.js/src/**",
      "./node_modules/tesseract.js-core/*.{js,wasm}",
    ],
  },
};

export default nextConfig;
