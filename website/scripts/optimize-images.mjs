/**
 * optimize-images.mjs
 *
 * Converts all .png / .jpg / .jpeg under public/blog/ and public/authors/
 * to WebP (quality 80, max-width 1600px), removes the originals, and
 * reports payload before/after.
 *
 * Run from the website/ package root:
 *   node scripts/optimize-images.mjs
 */

import { createRequire } from "module";
import { readdirSync, statSync, unlinkSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");

const require = createRequire(import.meta.url);

// Set NODE_PATH so `require("sharp")` can resolve through the pnpm virtual store.
// pnpm does not hoist sharp to the flat node_modules by default; we find it in
// the content-addressable store and patch the module search paths before loading.
const sharpStoreDir = path.join(
  ROOT,
  "node_modules/.pnpm/sharp@0.34.5/node_modules",
);
const sharpStoreDir2 = path.join(
  ROOT,
  "node_modules/.pnpm/sharp@0.33.5/node_modules",
);
const nodePath = (process.env.NODE_PATH || "")
  .split(path.delimiter)
  .filter(Boolean);
nodePath.unshift(sharpStoreDir, sharpStoreDir2);
process.env.NODE_PATH = nodePath.join(path.delimiter);
// Re-init so the new paths are recognized
require("module").Module._initPaths();

let sharp;
try {
  sharp = require("sharp");
} catch (err) {
  // Last resort: direct path
  try {
    sharp = require(path.join(sharpStoreDir, "sharp"));
  } catch (_) {
    try {
      sharp = require(path.join(sharpStoreDir2, "sharp"));
    } catch (__) {
      console.error("Could not load sharp. Aborting.", err.message);
      process.exit(1);
    }
  }
}

const RASTER_EXTS = new Set([".png", ".jpg", ".jpeg"]);
const MAX_WIDTH = 1600;
const WEBP_QUALITY = 80;

/** Recursively find all files under dir */
function walkDir(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDir(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

function bytesToMB(b) {
  return (b / 1024 / 1024).toFixed(2);
}

async function main() {
  console.log("sharp loaded OK:", sharp.versions?.sharp || "?");

  const dirs = [path.join(PUBLIC, "blog"), path.join(PUBLIC, "authors")];

  const allFiles = dirs.flatMap((d) => walkDir(d));
  const rasterFiles = allFiles.filter((f) =>
    RASTER_EXTS.has(path.extname(f).toLowerCase()),
  );

  console.log(`Found ${rasterFiles.length} raster images to convert.`);

  let beforeBytes = 0;
  for (const f of rasterFiles) {
    beforeBytes += statSync(f).size;
  }
  console.log(`Total raster payload before: ${bytesToMB(beforeBytes)} MB`);

  let converted = 0;
  let afterBytes = 0;
  const results = [];

  for (const src of rasterFiles) {
    const ext = path.extname(src).toLowerCase();
    const webpPath = src.slice(0, -ext.length) + ".webp";

    try {
      const meta = await sharp(src).metadata();
      const originalSize = statSync(src).size;

      let pipeline = sharp(src);
      if (meta.width && meta.width > MAX_WIDTH) {
        pipeline = pipeline.resize(MAX_WIDTH, null, {
          withoutEnlargement: true,
          fit: "inside",
        });
      }

      pipeline = pipeline.webp({ quality: WEBP_QUALITY });
      await pipeline.toFile(webpPath);

      const newSize = statSync(webpPath).size;
      const relPath = src.replace(PUBLIC + "/", "");
      const label = relPath.split("/").slice(-2).join("/");

      // If the WebP came out no smaller than the source (happens for already-
      // efficient PNGs/JPEGs), keep the original and drop the WebP — shipping a
      // larger file to every visitor is the opposite of optimizing.
      if (newSize >= originalSize) {
        unlinkSync(webpPath);
        afterBytes += originalSize;
        console.log(
          `  = ${label}  kept original (webp was larger: ` +
            `${(originalSize / 1024).toFixed(0)}KB → ${(newSize / 1024).toFixed(0)}KB)`,
        );
        continue;
      }

      afterBytes += newSize;
      unlinkSync(src);

      const saving = originalSize - newSize;
      const savingPct = ((saving / originalSize) * 100).toFixed(1);
      results.push({
        file: "/" + relPath,
        originalSize,
        newSize,
        savingPct,
        originalWidth: meta.width,
      });

      console.log(
        `  ✓ ${label} → .webp  ` +
          `${(originalSize / 1024).toFixed(0)}KB → ${(newSize / 1024).toFixed(0)}KB ` +
          `(-${savingPct}%)`,
      );
      converted++;
    } catch (err) {
      console.error(`  ✗ Failed: ${src} — ${err.message}`);
    }
  }

  console.log(`\nConverted: ${converted} / ${rasterFiles.length} images`);
  console.log(`After total WebP payload: ${bytesToMB(afterBytes)} MB`);
  const savedMB = beforeBytes - afterBytes;
  console.log(
    `Saved: ${bytesToMB(savedMB)} MB ` +
      `(${((savedMB / beforeBytes) * 100).toFixed(1)}%)`,
  );

  const manifest = {
    convertedAt: new Date().toISOString(),
    count: converted,
    beforeMB: parseFloat(bytesToMB(beforeBytes)),
    afterMB: parseFloat(bytesToMB(afterBytes)),
    savedMB: parseFloat(bytesToMB(savedMB)),
    results,
  };
  const manifestPath = path.join(ROOT, "scripts", "image-manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\nManifest written to scripts/image-manifest.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
