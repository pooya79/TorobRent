import type { Config } from "@react-router/dev/config";

export default {
  appDirectory: "src",
  ssr: true,
  prerender: ["/guide", "/contact", "/privacy", "/terms"],
} satisfies Config;
