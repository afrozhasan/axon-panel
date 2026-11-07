import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const here = import.meta.dirname;

export default defineConfig({
  root: here,
  plugins: [react(), tailwindcss()],
  build: {
    outDir: path.resolve(here, "../dist"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5173,
    host: "127.0.0.1",
    proxy: {
      "/api": {
        target: "http://127.0.0.1:9090",
        changeOrigin: false,
        ws: true,
      },
    },
  },
});
