import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const usePolling = process.env.VITE_USE_POLLING === "true";

export default defineConfig({
  server: {
    port: 3000,
    host: "0.0.0.0",
    watch: usePolling
      ? {
          usePolling: true,
          interval: 1000,
        }
      : undefined,
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    tanstackStart(),
    viteReact(),
  ],
});
