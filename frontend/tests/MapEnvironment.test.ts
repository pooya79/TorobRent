import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

test("selects the independent OpenStreetMap adapter from build configuration", async () => {
  vi.stubEnv("VITE_MAP_ADAPTER", "openstreetmap");

  const { configuredMapAdapterName } =
    await import("@/features/map/environment");

  expect(configuredMapAdapterName).toBe("openstreetmap");
});

test("keeps Neshan as the safe default for unknown adapter settings", async () => {
  vi.stubEnv("VITE_MAP_ADAPTER", "unknown");

  const { configuredMapAdapterName } =
    await import("@/features/map/environment");

  expect(configuredMapAdapterName).toBe("neshan");
});
