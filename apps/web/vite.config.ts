import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectManifest: { globPatterns: ["**/*.{js,css,html,svg,woff2}"] },
      registerType: "prompt",
      includeAssets: ["icons/app-icon.svg"],
      manifest: {
        name: "مدیریت کسب‌وکار",
        short_name: "مدیریت کسب‌وکار",
        description: "مدیریت فروش، موجودی و امور مالی کسب‌وکار",
        lang: "fa",
        dir: "rtl",
        start_url: "/app",
        scope: "/",
        display: "standalone",
        background_color: "#f7f6f1",
        theme_color: "#f7f6f1",
        icons: [
          { src: "/icons/app-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "/icons/app-icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
});
