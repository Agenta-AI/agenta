#!/usr/bin/env node
/**
 * fetch-fonts.mjs — populate website/public/fonts/ with the licensed brand woff2
 * (GT Alpina, PP Mondwest) before `astro dev` / `astro build`.
 *
 * Those binaries are licensed for USE but not for REDISTRIBUTION, so they are
 * gitignored (see website/.gitignore) and never live in this public repo. This
 * script fetches them at build time. It NEVER fails the build: if no source is
 * available it logs a notice and exits 0, and the CSS falls back to system
 * serif/mono stacks (see src/styles/tokens.css).
 *
 * Resolution order:
 *   1. Already present in public/fonts/           → nothing to do.
 *   2. Local directory (env AGENTA_FONTS_DIR,      → copy from disk.
 *      default /home/mahmoud/code/agenta-fonts)
 *   3. Cloudflare R2 over the S3 API, if creds set → download (SigV4 GET).
 *        R2_S3_ENDPOINT       e.g. https://<accountid>.r2.cloudflarestorage.com
 *        R2_ACCESS_KEY_ID
 *        R2_SECRET_ACCESS_KEY
 *        R2_FONTS_BUCKET      default: agenta-brand-fonts
 *   4. None of the above                           → warn, use fallback fonts.
 *
 * No secret values are ever hard-coded; everything sensitive comes from the env
 * (CI secrets, or a local .env you source before running).
 */

import { createHash, createHmac } from "node:crypto";
import { existsSync, mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const FONTS = [
  "GT-Alpina-Light.woff2",
  "GT-Alpina-Light-Italic.woff2",
  "GT-Alpina-Regular.woff2",
  "GT-Alpina-Regular-Italic.woff2",
  "GT-Alpina-Medium.woff2",
  "PPMondwest-Regular.woff2",
];

const DEFAULT_LOCAL_DIR = "/home/mahmoud/code/agenta-fonts";
const DEFAULT_BUCKET = "agenta-brand-fonts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fontsDir = join(__dirname, "..", "public", "fonts");

function missingFonts() {
  return FONTS.filter((f) => !existsSync(join(fontsDir, f)));
}

// ── 1. already present ─────────────────────────────────────────────────────────
if (missingFonts().length === 0) {
  console.log("[fetch-fonts] all licensed fonts already present, nothing to do.");
  process.exit(0);
}

mkdirSync(fontsDir, { recursive: true });

// ── 2. local directory ─────────────────────────────────────────────────────────
const localDir = process.env.AGENTA_FONTS_DIR || DEFAULT_LOCAL_DIR;
if (existsSync(localDir)) {
  let copied = 0;
  for (const f of missingFonts()) {
    const src = join(localDir, f);
    if (existsSync(src)) {
      copyFileSync(src, join(fontsDir, f));
      copied += 1;
    }
  }
  if (copied > 0) {
    console.log(`[fetch-fonts] copied ${copied} font(s) from ${localDir}.`);
  }
  if (missingFonts().length === 0) {
    console.log("[fetch-fonts] all fonts resolved from local directory.");
    process.exit(0);
  }
}

// ── 3. Cloudflare R2 (S3 API, SigV4) ────────────────────────────────────────────
const endpoint = process.env.R2_S3_ENDPOINT;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucket = process.env.R2_FONTS_BUCKET || DEFAULT_BUCKET;

function sigv4Headers(url, accessKeyId, secretAccessKey) {
  // Minimal AWS SigV4 for an unsigned-body GET against an S3-compatible endpoint.
  const region = "auto"; // R2 uses "auto".
  const service = "s3";
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const { host, pathname } = new URL(url);
  const payloadHash = createHash("sha256").update("").digest("hex");

  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    "GET",
    pathname,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");

  const hmac = (key, data) => createHmac("sha256", key).update(data).digest();
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    Authorization: authorization,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
}

if (endpoint && accessKeyId && secretAccessKey) {
  const base = endpoint.replace(/\/+$/, "");
  let downloaded = 0;
  for (const f of missingFonts()) {
    const url = `${base}/${bucket}/${f}`;
    try {
      const res = await fetch(url, {
        headers: sigv4Headers(url, accessKeyId, secretAccessKey),
      });
      if (!res.ok) {
        console.warn(`[fetch-fonts] R2 GET ${f} → HTTP ${res.status}; skipping.`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(join(fontsDir, f), buf);
      downloaded += 1;
    } catch (err) {
      console.warn(`[fetch-fonts] R2 GET ${f} failed: ${err.message}; skipping.`);
    }
  }
  if (downloaded > 0) {
    console.log(`[fetch-fonts] downloaded ${downloaded} font(s) from R2 bucket ${bucket}.`);
  }
}

// ── 4. fallback ─────────────────────────────────────────────────────────────────
const stillMissing = missingFonts();
if (stillMissing.length > 0) {
  console.warn(
    `[fetch-fonts] ${stillMissing.length}/${FONTS.length} licensed font(s) unavailable ` +
      "(no local dir, no R2 creds, or fetch failed) — the site will render with system " +
      "serif/mono fallbacks. This is expected for forks/CI without the R2 secret."
  );
}

// Never fail the build.
process.exit(0);
