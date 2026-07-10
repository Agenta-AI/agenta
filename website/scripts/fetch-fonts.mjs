#!/usr/bin/env node
/**
 * fetch-fonts.mjs — prebuild step: downloads licensed woff2 files from the
 * private Cloudflare R2 bucket into public/fonts/ before `astro build`.
 *
 * GRACEFUL NO-OP: if CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID are absent,
 * OR if wrangler fails for any reason, this script logs a warning and exits 0.
 * The build then uses the system-font fallback stacks defined in tokens.css.
 *
 * HOW IT WORKS:
 *   npx wrangler r2 object get <bucket>/<key> --file public/fonts/<file>
 *
 * Both CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are read from the
 * environment (set them as CI secrets or in a local .env that you source
 * before running pnpm build).
 *
 * TODO: Before this script can run, the R2 bucket must be created:
 *   npx wrangler r2 bucket create agenta-website-fonts
 * And the licensed woff2 files must be uploaded:
 *   npx wrangler r2 object put agenta-website-fonts/<key> --file <path>
 * See docs/design/marketing-website/deploy-runbook.md for the full recipe.
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// ── Config ────────────────────────────────────────────────────────────────────

// TODO: Create this bucket with:
//   npx wrangler r2 bucket create agenta-website-fonts
const BUCKET = "agenta-website-fonts";

// The six licensed woff2 files that must live in the R2 bucket.
// Filenames in the bucket MUST match these exactly (the R2 key is the filename).
// These are gitignored in website/.gitignore (public/fonts/GT-Alpina-* and PPMondwest-*).
const FONTS = [
  "GT-Alpina-Light.woff2",
  "GT-Alpina-Light-Italic.woff2",
  "GT-Alpina-Regular.woff2",
  "GT-Alpina-Regular-Italic.woff2",
  "GT-Alpina-Medium.woff2",
  "PPMondwest-Regular.woff2",
];

// ── Entrypoint ────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const fontsDir = join(__dirname, "..", "public", "fonts");

// Check credentials — graceful no-op if absent.
const token = process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;

if (!token || !accountId) {
  console.warn(
    "[fetch-fonts] CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID not set. " +
      "Skipping licensed font download — site will use system-font fallbacks."
  );
  process.exit(0);
}

// Ensure the output directory exists.
if (!existsSync(fontsDir)) {
  mkdirSync(fontsDir, { recursive: true });
}

// Download each font file from R2.
let failed = 0;
for (const font of FONTS) {
  const dest = join(fontsDir, font);
  const r2Path = `${BUCKET}/${font}`;

  // Skip if already present (allows incremental builds without re-downloading).
  if (existsSync(dest)) {
    console.log(`[fetch-fonts] ${font} already present, skipping.`);
    continue;
  }

  console.log(`[fetch-fonts] Downloading ${r2Path} → public/fonts/${font}`);
  try {
    execSync(
      `npx wrangler r2 object get "${r2Path}" --file "${dest}"`,
      {
        stdio: "inherit",
        env: {
          ...process.env,
          CLOUDFLARE_API_TOKEN: token,
          CLOUDFLARE_ACCOUNT_ID: accountId,
        },
      }
    );
  } catch (err) {
    // Log and continue — a single missing file should not break the build.
    // The font-family fallback stack in tokens.css will cover the gap.
    console.warn(
      `[fetch-fonts] WARNING: failed to download ${font}: ${err.message}. ` +
        "Continuing — system-font fallback will be used for this face."
    );
    failed += 1;
  }
}

if (failed > 0) {
  console.warn(
    `[fetch-fonts] ${failed}/${FONTS.length} font(s) could not be downloaded. ` +
      "The build will proceed with system-font fallbacks for those faces."
  );
} else {
  console.log(
    `[fetch-fonts] All ${FONTS.length} licensed fonts downloaded successfully.`
  );
}

// Always exit 0 so a font-fetch failure never breaks the build pipeline.
process.exit(0);
