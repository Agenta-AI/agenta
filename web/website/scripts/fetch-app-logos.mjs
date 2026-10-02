#!/usr/bin/env node
// Fetches each catalog app's official logo (the product's source) into gitignored public/logos/apps/; never fails the build.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE = "https://logos.composio.dev/api";
const TIMEOUT_MS = 10_000;
const SLUG = /^[a-z0-9_-]+$/;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "logos", "apps");
const data = JSON.parse(readFileSync(join(root, "src", "data", "templates.json"), "utf8"));

const slugs = [
  ...new Set(
    data.templates.flatMap((template) =>
      template.connections.flatMap((connection) => [
        connection.primary?.slug,
        ...(connection.alternatives ?? []),
      ]),
    ),
  ),
].filter((slug) => typeof slug === "string" && SLUG.test(slug));

const missing = slugs.filter((slug) => !existsSync(join(outDir, `${slug}.svg`)));
if (missing.length === 0) {
  console.log(`[fetch-app-logos] all ${slugs.length} app logos present, nothing to do.`);
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });

const fetchLogo = async (slug) => {
  try {
    const response = await fetch(`${SOURCE}/${slug}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const type = response.headers.get("content-type") ?? "";
    const body = await response.text();
    if (!response.ok || !type.includes("svg") || !body.includes("<svg")) {
      return `${slug} (${response.status} ${type || "no type"})`;
    }
    writeFileSync(join(outDir, `${slug}.svg`), body);
    return null;
  } catch (error) {
    return `${slug} (${error instanceof Error ? error.message : error})`;
  }
};

const failed = (await Promise.all(missing.map(fetchLogo))).filter(Boolean);
console.log(`[fetch-app-logos] fetched ${missing.length - failed.length} of ${missing.length} missing logos.`);
if (failed.length) {
  console.warn(`[fetch-app-logos] these apps fall back to their initial: ${failed.join(", ")}`);
}
