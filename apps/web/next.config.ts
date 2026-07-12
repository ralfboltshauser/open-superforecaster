import type { NextConfig } from "next";
import { resolve } from "node:path";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  turbopack: { root: resolve(import.meta.dirname, "../..") },
  serverExternalPackages: ["@duckdb/node-api", "@duckdb/node-bindings"],
  transpilePackages: [
    "@open-superforecaster/backend",
    "@open-superforecaster/config",
    "@open-superforecaster/db",
    "@open-superforecaster/artifact-store",
    "@open-superforecaster/evals",
    "@open-superforecaster/workflow-contracts",
  ],
};

export default nextConfig;
