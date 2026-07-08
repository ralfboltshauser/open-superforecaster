import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
