import { defineConfig } from "vite";

export default defineConfig({
  base: "/charts/",
  server: {
    port: 7750,
    proxy: {
      "/history": "http://127.0.0.1:44124",
      "/list": "http://127.0.0.1:44124",
      "/api": "http://127.0.0.1:44124",
    },
  },
  build: {
    outDir: "dist",
  },
});
