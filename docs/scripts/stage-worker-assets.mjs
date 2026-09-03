// Stages the Cloudflare Workers Static Assets metadata files next to the built
// docs, and is run by `pnpm run build:worker` right after `docusaurus build`.
//
// The docs build is written to dist/docs so that the file tree matches the
// public /docs/ URL prefix (Cloudflare serves a subdirectory by mirroring the
// path, which is what replaces the old Vercel `/docs/:path*` rewrite). But
// `_headers` and `_redirects` are only read at the ROOT of the assets
// directory, so they cannot live inside the build output: they are kept in
// docs/worker-assets/ and copied to dist/ here.
//
// With DOCS_NOINDEX=true (set for CI preview deploys) it also writes a
// disallow-all robots.txt at the preview host root, so a public *.workers.dev
// preview can never be indexed as duplicate content.

import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const docsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(docsRoot, "dist");
const siteDir = path.join(distDir, "docs");
const sourceDir = path.join(docsRoot, "worker-assets");

const exists = async (target) => {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
};

if (!(await exists(siteDir))) {
  console.error(
    `stage-worker-assets: ${path.relative(docsRoot, siteDir)} is missing. ` +
      "Run `docusaurus build --out-dir dist/docs` first.",
  );
  process.exit(1);
}

await mkdir(distDir, { recursive: true });

for (const name of ["_headers", "_redirects"]) {
  await copyFile(path.join(sourceDir, name), path.join(distDir, name));
  console.log(`stage-worker-assets: staged dist/${name}`);
}

if (process.env.DOCS_NOINDEX === "true") {
  await writeFile(
    path.join(distDir, "robots.txt"),
    "# Preview deploy — never index this host.\nUser-agent: *\nDisallow: /\n",
  );
  console.log("stage-worker-assets: wrote dist/robots.txt (noindex preview)");
}
