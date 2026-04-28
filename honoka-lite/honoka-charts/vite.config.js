import { defineConfig } from "vite";

export default defineConfig({
  base: "/charts/",
  server: {
    port: 7750,
    proxy: {
      "/history": "http://127.0.0.1:7749",
    },
  },
  build: {
    outDir: "dist",
  },
});
