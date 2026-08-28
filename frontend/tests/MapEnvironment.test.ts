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

test("defaults to OpenStreetMap when no supported adapter is configured", async () => {
  vi.stubEnv("VITE_MAP_ADAPTER", "");

  const { configuredMapAdapterName } =
    await import("@/features/map/environment");

  expect(configuredMapAdapterName).toBe("openstreetmap");
});
