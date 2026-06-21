import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  // `vite preview` serves the production build on Railway; allow its domain.
  preview: {
    allowedHosts: true,
  },
});
