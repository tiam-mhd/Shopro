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
      includeAssets: ["icons/Logo.webp", "icons/Logo-dark.webp", "icons/icon-192.webp", "icons/icon-512.webp", "icons/icon-maskable-512.webp"],
      manifest: {
        name: "شاپرو | مدیریت کسب‌وکار",
        short_name: "شاپرو",
        description: "مدیریت فروش، موجودی و امور مالی کسب‌وکار",
        lang: "fa",
        dir: "rtl",
        start_url: "/app",
        scope: "/",
        display: "standalone",
        background_color: "#f7f6f1",
        theme_color: "#f7f6f1",
        icons: [
          { src: "/icons/icon-192.webp", sizes: "192x192", type: "image/webp", purpose: "any" },
          { src: "/icons/icon-512.webp", sizes: "512x512", type: "image/webp", purpose: "any" },
          { src: "/icons/icon-maskable-512.webp", sizes: "512x512", type: "image/webp", purpose: "maskable" },
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
