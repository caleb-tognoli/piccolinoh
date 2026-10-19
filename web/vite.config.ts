import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [preact(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/ws": {
        target: "ws://127.0.0.1:3000",
        ws: true,
        rewriteWsOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
