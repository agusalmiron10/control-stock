import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// El frontend (React) vive en /web y se compila a /dist/client,
// que es el directorio de assets que sirve el Worker (ver wrangler.jsonc).
// En desarrollo, Vite proxea /api al Worker levantado por `wrangler dev`.
export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname, "web"),
  build: {
    outDir: resolve(__dirname, "dist/client"),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
});
