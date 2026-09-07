// Post-build assertions for the agent-readiness surfaces.
//
// These are the things a unit test cannot see: that Astro actually emitted the
// markdown twin of every route, that the published OpenAPI spec is there and
// parses, and that the twins never leaked into the sitemap (they are alternate
// representations of pages that are already listed, not pages of their own).
//
// Run after `pnpm build`; exits non-zero with a list of what is missing.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const failures = [];

const check = (condition, message) => {
  if (!condition) failures.push(message);
};

check(existsSync(dist), "dist/ does not exist — run `pnpm build` first.");
if (!existsSync(dist)) {
  console.error(failures.join("\n"));
  process.exit(1);
}

// 1. Every route has the markdown twin the worker looks for ("<path>.md").
for (const twin of [
  "index.md",
  "api.md",
  "pricing.md",
  "contact.md",
  "imprint.md",
  "blog.md",
  "authors.md",
]) {
  check(existsSync(resolve(dist, twin)), `missing markdown twin: dist/${twin}`);
}

const posts = readdirSync(resolve(root, "src/content/posts")).filter((file) =>
  file.endsWith(".mdx"),
);
for (const post of posts) {
  const twin = `blog/${post.replace(/\.mdx$/, "")}.md`;
  check(existsSync(resolve(dist, twin)), `missing markdown twin: dist/${twin}`);
}

const authors = readdirSync(resolve(root, "src/content/authors")).filter(
  (file) => file.endsWith(".json"),
);
for (const author of authors) {
  const twin = `authors/${author.replace(/\.json$/, "")}.md`;
  check(existsSync(resolve(dist, twin)), `missing markdown twin: dist/${twin}`);
}

// 2. The twin content is real markdown, not an empty file or an HTML page.
if (existsSync(resolve(dist, "index.md"))) {
  const home = readFileSync(resolve(dist, "index.md"), "utf8");
  check(home.startsWith("# "), "dist/index.md does not start with an H1.");
  check(home.length > 500, "dist/index.md is under 500 characters.");
  check(
    home.includes("https://agenta.ai/openapi.json"),
    "dist/index.md does not point at the OpenAPI spec.",
  );
}

// 3. The API entry point exists on our own origin, and llms.txt tells an agent
//    when to reach for us. Both are audit requirements, not decoration.
check(
  existsSync(resolve(dist, "api/index.html")),
  "missing dist/api/index.html (the same-origin API page).",
);
const llms = existsSync(resolve(dist, "llms.txt"))
  ? readFileSync(resolve(dist, "llms.txt"), "utf8")
  : "";
check(
  llms.includes("## When to use Agenta"),
  "llms.txt has no when-to-use guidance.",
);
check(
  llms.includes("Authorization: ApiKey"),
  "llms.txt does not say how to authenticate a call.",
);
if (existsSync(resolve(dist, "index.html"))) {
  check(
    readFileSync(resolve(dist, "index.html"), "utf8").includes('href="/api"'),
    "the homepage does not link to the API page.",
  );
}

// 4. The 404 page is a real asset — the worker fetches it by path.
check(existsSync(resolve(dist, "404.html")), "missing dist/404.html.");

// 5. The published API specification.
const specPath = resolve(dist, "openapi.json");
check(existsSync(specPath), "missing dist/openapi.json.");
if (existsSync(specPath)) {
  try {
    const spec = JSON.parse(readFileSync(specPath, "utf8"));
    check(Boolean(spec.openapi), "dist/openapi.json has no `openapi` version.");
    check(
      Object.keys(spec.paths ?? {}).length > 100,
      "dist/openapi.json looks truncated.",
    );
    // The exact contract from scripts/copy-openapi.mjs: a stale or unfiltered
    // spec must not be publishable just because its URLs happen to be absolute.
    check(
      JSON.stringify(spec.servers?.map((server) => server.url)) ===
        JSON.stringify([
          "https://us.cloud.agenta.ai/api",
          "https://eu.cloud.agenta.ai/api",
        ]),
      `dist/openapi.json servers are not the published cloud hosts: ${JSON.stringify(spec.servers)}`,
    );
    const admin = Object.keys(spec.paths ?? {}).filter((path) =>
      path.startsWith("/admin/"),
    );
    check(
      admin.length === 0,
      `dist/openapi.json still exposes ${admin.length} admin path(s), e.g. ${admin[0]}`,
    );
  } catch (error) {
    failures.push(`dist/openapi.json does not parse: ${error.message}`);
  }
}

// 6. Sitemap entries must be final, self-canonical page URLs. The site root is
//    the only URL whose path legitimately ends in a slash.
const sitemap = resolve(dist, "sitemap-0.xml");
if (existsSync(sitemap)) {
  const sitemapXml = readFileSync(sitemap, "utf8");
  check(!sitemapXml.includes(".md<"), "sitemap-0.xml lists a .md twin.");

  const urls = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
    ([, url]) => url,
  );
  for (const url of urls) {
    const { pathname } = new URL(url);
    check(
      pathname === "/" || !pathname.endsWith("/"),
      `sitemap URL has a trailing slash: ${url}`,
    );

    const html = resolve(
      dist,
      pathname === "/" ? "index.html" : `${pathname.slice(1)}/index.html`,
    );
    check(existsSync(html), `sitemap URL has no built page: ${url}`);
    if (existsSync(html)) {
      const canonical = readFileSync(html, "utf8").match(
        /<link rel="canonical" href="([^"]+)"/,
      )?.[1];
      check(canonical === url, `sitemap URL is not self-canonical: ${url}`);
    }
  }
}

if (failures.length > 0) {
  console.error(`[verify-build] ${failures.length} problem(s):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  `[verify-build] ok — ${posts.length + authors.length + 7} markdown twins, 404 page, and the OpenAPI spec are all in dist/.`,
);
