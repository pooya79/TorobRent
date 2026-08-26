import type { Config } from "@react-router/dev/config";

export default {
  appDirectory: "src",
  ssr: true,
  prerender: [
    "/about",
    "/guide",
    "/contact",
    "/advertise",
    "/privacy",
    "/terms",
    "/photo-credits",
  ],
} satisfies Config;
