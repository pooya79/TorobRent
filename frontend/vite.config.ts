import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tailwindcss(), process.env.VITEST ? react() : reactRouter()],
  resolve: { tsconfigPaths: true },
  optimizeDeps: {
    // Prevent cold CI starts from reloading the page during browser hydration.
    include: [
      "@radix-ui/react-slot",
      "@radix-ui/react-alert-dialog",
      "@radix-ui/react-checkbox",
      "@radix-ui/react-dialog",
      "@radix-ui/react-label",
      "@radix-ui/react-radio-group",
      "@radix-ui/react-select",
      "@radix-ui/react-separator",
      "@tanstack/react-query",
      "class-variance-authority",
      "clsx",
      "lucide-react",
      "openapi-fetch",
      "tailwind-merge",
    ],
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": process.env.VITE_PROXY_TARGET ?? "http://localhost:8000",
      "/admin": process.env.VITE_PROXY_TARGET ?? "http://localhost:8000",
      "/static": process.env.VITE_PROXY_TARGET ?? "http://localhost:8000",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
