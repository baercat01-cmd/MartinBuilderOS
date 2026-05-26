/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";
import fs from "fs";

// https://vitejs.dev/config/
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  server: {
    host: "::",
    port: 8080,
    strictPort: false, // use next free port if 8080 is taken
    hmr: {
      // For OnSpace preview - detect and use the preview domain
      protocol: 'wss',
      // OnSpace preview domains follow pattern: *.onspace.meme or *.preview.onspace.ai
      // Let the client determine the host automatically
      clientPort: 443,
      overlay: true,
      // Don't specify host - let browser use current domain
    },
  },
  plugins: [
    react(),
    {
      name: "debug-log-ingest",
      configureServer(server) {
        const logPath = path.join(__dirname, ".cursor", "debug-ca9250.log");
        server.middlewares.use("/__debug/log", (req, res, next) => {
          if (req.method !== "POST") {
            next();
            return;
          }
          let body = "";
          req.on("data", (chunk) => {
            body += chunk;
          });
          req.on("end", () => {
            try {
              fs.mkdirSync(path.dirname(logPath), { recursive: true });
              fs.appendFileSync(logPath, `${body.trim()}\n`);
            } catch {
              /* ignore */
            }
            res.statusCode = 204;
            res.end();
          });
        });
      },
    },
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["martin-logo.png", "favicon.ico"],
      manifest: {
        short_name: "Martin Builder OS",
        name: "Martin Builder OS",
        description: "Martin Builder OS",
        start_url: "/office?tab=jobs",
        display: "standalone",
        background_color: "#000000",
        theme_color: "#4179bc",
        icons: [
          {
            src: "/martin-logo.png?v=3",
            sizes: "192x192",
            type: "image/png",
            purpose: "any maskable",
          },
          {
            src: "/martin-logo.png?v=3",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        navigateFallback: "/index.html",
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024, // 4 MiB (main chunk exceeds 2 MiB default)
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/[^/]*\/(api|rest|supabase|functions)/,
            handler: "NetworkFirst",
            options: {
              cacheName: "api-cache",
              networkTimeoutSeconds: 10,
              expiration: { maxEntries: 32, maxAgeSeconds: 300 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // Disable sourcemaps to reduce peak memory during bundling
    sourcemap: false,
    // Increase chunk size warning limit
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Core React runtime
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/') || id.includes('node_modules/scheduler/')) {
            return 'vendor-react';
          }
          // Router
          if (id.includes('node_modules/react-router') || id.includes('node_modules/@remix-run/')) {
            return 'vendor-router';
          }
          // Supabase
          if (id.includes('node_modules/@supabase/')) {
            return 'vendor-supabase';
          }
          // Recharts + D3
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3') || id.includes('node_modules/victory')) {
            return 'vendor-charts';
          }
          // Radix UI / shadcn primitives
          if (id.includes('node_modules/@radix-ui/')) {
            return 'vendor-radix';
          }
          // lucide icons
          if (id.includes('node_modules/lucide-react')) {
            return 'vendor-icons';
          }
          // React Query / Zustand / form libs
          if (
            id.includes('node_modules/@tanstack/') ||
            id.includes('node_modules/zustand') ||
            id.includes('node_modules/react-hook-form') ||
            id.includes('node_modules/zod')
          ) {
            return 'vendor-state';
          }
          // PDF / xlsx / heavy utilities
          if (
            id.includes('node_modules/jspdf') ||
            id.includes('node_modules/xlsx') ||
            id.includes('node_modules/html2canvas') ||
            id.includes('node_modules/dompurify')
          ) {
            return 'vendor-heavy';
          }
          // Date utilities
          if (id.includes('node_modules/date-fns') || id.includes('node_modules/dayjs')) {
            return 'vendor-date';
          }
          // Fleet / vehicle pages (large isolated feature)
          if (id.includes('src/components/fleet') || id.includes('src/pages/fleet')) {
            return 'feature-fleet';
          }
          // Foreman / field pages
          if (id.includes('src/components/foreman') || id.includes('src/pages/foreman')) {
            return 'feature-foreman';
          }
          // Plans / 3D estimator
          if (id.includes('src/components/plans') || id.includes('BuildingEstimator') || id.includes('BuildingModel')) {
            return 'feature-plans';
          }
          // Customer portal
          if (id.includes('src/components/customer') || id.includes('src/pages/customer')) {
            return 'feature-portal';
          }
          // All remaining node_modules
          if (id.includes('node_modules/')) {
            return 'vendor-misc';
          }
        },
      },
    },
  },
});
