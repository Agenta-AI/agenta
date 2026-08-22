// Publish the Agenta OpenAPI specification at https://agenta.ai/openapi.json.
//
// Why here: agents discover an API surface by fetching /openapi.json from the
// site they were pointed at. The API itself runs on us/eu.cloud.agenta.ai, so
// the copy we publish rewrites the spec's relative server entry to the real
// base URLs — a relative "/api" would resolve against agenta.ai and mislead
// every client that reads it.
//
// Source of truth is the committed spec the docs site already renders
// (docs/docs/reference/openapi.json, refreshed by the `update-api-docs` skill).
// We copy it at build time rather than committing a second copy that drifts.
// The output (public/openapi.json) is gitignored, like the licensed fonts.
//
// Wired as a `prebuild` step. In CI a missing or invalid spec FAILS the build —
// silently shipping no spec would regress the agent-readiness audit. Locally it
// warns and continues so a partial checkout never blocks `pnpm dev`.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(here, "../../docs/docs/reference/openapi.json");
const TARGET = resolve(here, "../public/openapi.json");

/** Paths we do not advertise on the marketing domain. */
const PRIVATE_PREFIXES = ["/admin/"];

const SERVERS = [
  { url: "https://us.cloud.agenta.ai/api", description: "Agenta Cloud (US)" },
  { url: "https://eu.cloud.agenta.ai/api", description: "Agenta Cloud (EU)" },
];

/**
 * Make a published copy of the spec: real server URLs, no admin surface.
 * Exported for the unit test; the script body below is the CLI wrapper.
 */
export function normalize(spec) {
  if (!spec || typeof spec !== "object" || !spec.openapi || !spec.paths) {
    throw new Error("not a valid OpenAPI document (missing `openapi`/`paths`)");
  }

  const paths = Object.fromEntries(
    Object.entries(spec.paths).filter(
      ([path]) => !PRIVATE_PREFIXES.some((prefix) => path.startsWith(prefix)),
    ),
  );

  return {
    ...spec,
    servers: SERVERS,
    paths,
    info: {
      ...spec.info,
      // Point a reader at the docs without editing the generated description.
      "x-documentation-url": "https://docs.agenta.ai",
    },
  };
}

function main() {
  const inCI = Boolean(process.env.CI);

  let published;
  try {
    published = normalize(JSON.parse(readFileSync(SOURCE, "utf8")));
  } catch (error) {
    const message = `[copy-openapi] cannot publish ${SOURCE}: ${error.message}`;
    if (inCI) {
      console.error(message);
      process.exit(1);
    }
    console.warn(`${message}\n[copy-openapi] skipping (not CI).`);
    return;
  }

  mkdirSync(dirname(TARGET), { recursive: true });
  writeFileSync(TARGET, JSON.stringify(published));

  const removed =
    Object.keys(JSON.parse(readFileSync(SOURCE, "utf8")).paths).length -
    Object.keys(published.paths).length;
  console.log(
    `[copy-openapi] wrote public/openapi.json — ${Object.keys(published.paths).length} paths (${removed} private paths removed).`,
  );
}

// Only run when executed directly, so the test can import `normalize`.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
