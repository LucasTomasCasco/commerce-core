import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// La API se apunta con API_URL para no chocar con otros servicios locales en el puerto 3000.
const apiTarget = process.env.API_URL ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": apiTarget,
      "/docs": apiTarget,
      "/openapi.json": apiTarget,
    },
  },
});
