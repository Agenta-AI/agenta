// Prints markdown links to the docs pages a pull request changed, so the
// preview comment can deep-link straight into the pages under review.
//
// Usage: node scripts/changed-pages.mjs <preview-url> <changed-file>...
//   the preview URL may be the bare host or the host plus /docs
//   changed files are repo-relative paths, e.g. docs/docs/guides/foo.mdx
//
// The source-file to URL mapping is NOT guessed from the path: numeric prefixes
// (06-foo.mdx), `slug:` frontmatter, underscore-excluded partials and versioned
// docs all break naive derivation. Instead it reads the metadata Docusaurus
// writes for every page during the build (.docusaurus/**/site-*.json), which
// carries the real `source` and `permalink`. So this must run AFTER the build.
//
// Best effort by design: it prints nothing at all rather than a wrong link.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const MAX_LINKS = 10;

const docsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [rawOrigin, ...changed] = process.argv.slice(2);

if (!rawOrigin || changed.length === 0) process.exit(0);

// Permalinks already carry the /docs prefix in a production build, so accept
// either the bare host or the host plus /docs and normalise to the host.
const origin = rawOrigin.replace(/\/+$/, "").replace(/\/docs$/, "");

const collectMetadata = async (dir) => {
  const found = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await collectMetadata(full)));
    } else if (entry.name.startsWith("site-") && entry.name.endsWith(".json")) {
      found.push(full);
    }
  }
  return found;
};

const bySource = new Map();
for (const file of await collectMetadata(path.join(docsRoot, ".docusaurus"))) {
  try {
    const data = JSON.parse(await readFile(file, "utf8"));
    if (typeof data.source === "string" && typeof data.permalink === "string") {
      bySource.set(data.source, data);
    }
  } catch {
    // A metadata file we cannot parse is not worth failing the comment over.
  }
}

if (bySource.size === 0) process.exit(0);

const links = [];
for (const file of changed) {
  // Repo-relative docs/docs/foo.mdx is @site/docs/foo.mdx to Docusaurus.
  const relative = file.startsWith("docs/") ? file.slice("docs/".length) : file;
  const entry = bySource.get(`@site/${relative}`);
  if (!entry) continue;

  // permalink already carries the baseUrl in a production build, but not when
  // the metadata came from the localhost dev config. Normalise either shape.
  const permalink = entry.permalink.startsWith("/docs/")
    ? entry.permalink
    : `/docs${entry.permalink}`;
  // Escape the backslash first (in the same pass), otherwise a title ending in
  // one would escape the escape and break out of the link text.
  const title = (entry.title || permalink).replace(/([\\[\]])/g, "\\$1");
  links.push(`- [${title}](${origin}${permalink})`);
}

if (links.length === 0) process.exit(0);

console.log("**Pages changed in this pull request**");
console.log("");
for (const link of links.slice(0, MAX_LINKS)) console.log(link);
if (links.length > MAX_LINKS) {
  console.log(`- ...and ${links.length - MAX_LINKS} more`);
}
