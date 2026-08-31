import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const cityOrder = [
  "tehran",
  "isfahan",
  "mashhad",
  "shiraz",
  "tabriz",
  "qom",
  "ahvaz",
  "rasht",
  "kermanshah",
  "yazd",
] as const;
const requiredCreditFields = [
  "name",
  "landmark",
  "alt",
  "sourceUrl",
  "creator",
  "licenseName",
  "licenseUrl",
  "attribution",
] as const;
const expectedWidth = 640;
const expectedHeight = 427;
const perImageBudget = 130 * 1024;
const totalImageBudget = 600 * 1024;

type CityRecord = Record<string, unknown> & {
  slug?: unknown;
  image?: unknown;
  available?: unknown;
};

function inspectWebp(file: Buffer) {
  if (
    file.toString("ascii", 0, 4) !== "RIFF" ||
    file.toString("ascii", 8, 12) !== "WEBP"
  ) {
    throw new Error("not a WebP RIFF file");
  }

  let offset = 12;
  let dimensions: { width: number; height: number } | undefined;
  const chunks: string[] = [];
  while (offset + 8 <= file.length) {
    const chunk = file.toString("ascii", offset, offset + 4);
    const chunkSize = file.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    chunks.push(chunk);
    if (chunk === "VP8 ") {
      if (file.toString("hex", dataStart + 3, dataStart + 6) !== "9d012a") {
        throw new Error("invalid VP8 frame header");
      }
      dimensions = {
        width: file.readUInt16LE(dataStart + 6) & 0x3fff,
        height: file.readUInt16LE(dataStart + 8) & 0x3fff,
      };
    }
    offset = dataStart + chunkSize + (chunkSize % 2);
  }
  if (!dimensions) throw new Error("missing VP8 dimensions");
  return { ...dimensions, chunks };
}

export function validateCityImages(projectRoot = process.cwd()) {
  const errors: string[] = [];
  const manifestPath = path.join(
    projectRoot,
    "src/features/cities/cities.json",
  );
  const publicRoot = path.join(projectRoot, "public");
  const imageDirectory = path.join(publicRoot, "city-images");
  const cities = JSON.parse(readFileSync(manifestPath, "utf8")) as CityRecord[];

  if (cities.length !== cityOrder.length) {
    errors.push(
      `expected ${cityOrder.length} credit records, found ${cities.length}`,
    );
  }
  const actualOrder = cities.map((city) => city.slug);
  if (JSON.stringify(actualOrder) !== JSON.stringify(cityOrder)) {
    errors.push(`unexpected city order: ${actualOrder.join(", ")}`);
  }

  const expectedFiles = new Set<string>();
  let totalBytes = 0;
  for (const city of cities) {
    const label = typeof city.slug === "string" ? city.slug : "unknown city";
    for (const field of requiredCreditFields) {
      if (typeof city[field] !== "string" || city[field].trim() === "") {
        errors.push(`${label}: missing ${field}`);
      }
    }
    if (
      typeof city.alt !== "string" ||
      !/[\u0600-\u06ff]/u.test(city.alt) ||
      (typeof city.name === "string" && !city.alt.includes(city.name))
    ) {
      errors.push(
        `${label}: alt text must be meaningful Persian copy naming the city`,
      );
    }
    if (
      typeof city.sourceUrl !== "string" ||
      !/^https:\/\/(commons\.wikimedia\.org|unsplash\.com)\//u.test(
        city.sourceUrl,
      )
    ) {
      errors.push(
        `${label}: sourceUrl must be a traceable Commons or Unsplash URL`,
      );
    }
    if (
      typeof city.licenseUrl !== "string" ||
      !city.licenseUrl.startsWith("https://")
    ) {
      errors.push(`${label}: licenseUrl must be an HTTPS URL`);
    }
    if (city.available !== (city.slug === "tehran")) {
      errors.push(`${label}: only Tehran may be available`);
    }
    if (
      typeof city.image !== "string" ||
      !/^\/city-images\/[a-z-]+\.webp$/u.test(city.image)
    ) {
      errors.push(`${label}: image must be a local WebP under /city-images`);
      continue;
    }

    const relativeImage = city.image.slice(1);
    expectedFiles.add(path.basename(relativeImage));
    const imagePath = path.join(publicRoot, relativeImage);
    try {
      const bytes = statSync(imagePath).size;
      totalBytes += bytes;
      if (bytes > perImageBudget) {
        errors.push(
          `${label}: ${bytes} bytes exceeds the ${perImageBudget}-byte budget`,
        );
      }
      const details = inspectWebp(readFileSync(imagePath));
      if (
        details.width !== expectedWidth ||
        details.height !== expectedHeight
      ) {
        errors.push(
          `${label}: expected ${expectedWidth}x${expectedHeight}, found ${details.width}x${details.height}`,
        );
      }
      const metadata = details.chunks.filter((chunk) =>
        ["EXIF", "XMP ", "ICCP"].includes(chunk),
      );
      if (metadata.length > 0) {
        errors.push(
          `${label}: unnecessary metadata chunks: ${metadata.join(", ")}`,
        );
      }
    } catch (error) {
      errors.push(
        `${label}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const actualFiles = readdirSync(imageDirectory).filter(
    (file) => !file.startsWith("."),
  );
  for (const file of actualFiles) {
    if (!expectedFiles.has(file))
      errors.push(`unsupported or uncredited asset: ${file}`);
  }
  for (const file of expectedFiles) {
    if (!actualFiles.includes(file))
      errors.push(`missing credited asset: ${file}`);
  }
  if (totalBytes > totalImageBudget) {
    errors.push(
      `city images total ${totalBytes} bytes exceeds the ${totalImageBudget}-byte budget`,
    );
  }

  if (errors.length > 0) {
    throw new Error(`City image validation failed:\n- ${errors.join("\n- ")}`);
  }
  return { count: cities.length, totalBytes };
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  const result = validateCityImages();
  console.log(
    `Validated ${result.count} credited city images (${result.totalBytes} bytes).`,
  );
}
