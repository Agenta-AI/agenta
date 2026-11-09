// Publish the release feed at https://agenta.ai/releases.json.
//
// Agenta instances (cloud and self-hosted) download this file to show releases newer
// than the one they run, security fixes and notices. It is built from the same files
// the product bundles: changelog.json (made by `pnpm generate:releases` from the docs
// changelog) and the hand-written notices.json, so there is one changelog source.
// The output (public/releases.json) is gitignored, like public/openapi.json.
//
// Wired as a `prebuild` step. In CI a missing or invalid source FAILS the build;
// locally it warns and continues.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const RELEASES_DIR = resolve(here, "../../packages/agenta-navigation/src/releases");
const CHANGELOG = resolve(RELEASES_DIR, "changelog.json");
const NOTICES = resolve(RELEASES_DIR, "notices.json");
const TARGET = resolve(here, "../public/releases.json");

/** The feed: `{releases, notices}`. Exported for the unit test. */
export function buildFeed(releases, notices) {
  if (!Array.isArray(releases)) throw new Error("changelog.json must be a list");
  if (!Array.isArray(notices)) throw new Error("notices.json must be a list");
  return { releases, notices };
}

function main() {
  let feed;
  try {
    feed = buildFeed(
      JSON.parse(readFileSync(CHANGELOG, "utf8")),
      JSON.parse(readFileSync(NOTICES, "utf8")),
    );
  } catch (error) {
    const message = `[copy-releases] cannot publish the release feed: ${error.message}`;
    if (process.env.CI) {
      console.error(message);
      process.exit(1);
    }
    console.warn(`${message}\n[copy-releases] skipping (not CI).`);
    return;
  }

  mkdirSync(dirname(TARGET), { recursive: true });
  writeFileSync(TARGET, JSON.stringify(feed));
  console.log(
    `[copy-releases] wrote public/releases.json — ${feed.releases.length} releases, ${feed.notices.length} notices.`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  main();
}
