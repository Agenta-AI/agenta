// Checks that a candidate docs deployment serves every URL the live docs serve.
//
// Usage:
//   node scripts/check-parity.mjs <target> [options]
//
//   node scripts/check-parity.mjs https://pr-1234-agenta-docs-preview.example.workers.dev
//   node scripts/check-parity.mjs https://agenta.ai --sitemap https://agenta.ai/docs/sitemap.xml
//
// Options:
//   --sitemap <url>      sitemap to read the URL list from
//                        (default https://agenta.ai/docs/sitemap.xml)
//   --concurrency <n>    parallel requests (default 12)
//   --limit <n>          only check the first n URLs (for a quick smoke run)
//   --timeout <seconds>  per-request deadline (default 30)
//
// Only the ORIGIN of the target is used. Sitemap paths already carry the /docs
// prefix, so a target written as https://host/docs would otherwise produce
// /docs/docs/... and check the wrong URLs.
//
// After the sitemap sweep it also checks the shape of the deployment: a page
// that cannot exist must 404, and the cache policy from worker-assets/_headers
// must be in force on both HTML and hashed assets.
//
// Every URL in the sitemap is re-pointed at the target origin and requested.
// Redirects are followed by hand so the report shows the hops: this is how the
// trailing-slash behaviour and the "path segment containing a dot" cases get
// verified, not just the final status code. Exits non-zero if anything ends on
// a status other than 200.

import process from "node:process";

const args = process.argv.slice(2);
const target = args[0];
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
};

if (!target || target.startsWith("--")) {
  console.error("usage: node scripts/check-parity.mjs <target-origin> [--sitemap url] [--concurrency n] [--limit n]");
  process.exit(2);
}

// A bad number must stop the run, not silently spawn zero workers or check
// zero URLs: this script is the gate in front of a traffic cutover.
const integerOption = (name, fallback, { min }) => {
  const raw = option(name, fallback);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    console.error(`--${name} must be an integer of at least ${min}, got "${raw}"`);
    process.exit(2);
  }
  return value;
};

const sitemapUrl = option("sitemap", "https://agenta.ai/docs/sitemap.xml");
const concurrency = integerOption("concurrency", "12", { min: 1 });
const limit = integerOption("limit", "0", { min: 0 });
const timeoutMs = integerOption("timeout", "30", { min: 1 }) * 1000;
const MAX_HOPS = 3;

let targetOrigin;
try {
  targetOrigin = new URL(target).origin;
} catch {
  console.error(`target must be an absolute URL, got "${target}"`);
  process.exit(2);
}

const sitemapResponse = await fetch(sitemapUrl, { signal: AbortSignal.timeout(timeoutMs) });
if (!sitemapResponse.ok) {
  console.error(`could not read ${sitemapUrl}: HTTP ${sitemapResponse.status}`);
  process.exit(2);
}
const sitemap = await sitemapResponse.text();
const sourceUrls = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1].trim());
if (sourceUrls.length === 0) {
  console.error(`${sitemapUrl} listed no <loc> URLs, so there is nothing to check`);
  process.exit(2);
}
const urls = (limit > 0 ? sourceUrls.slice(0, limit) : sourceUrls).map((raw) => {
  const source = new URL(raw);
  return { source: raw, url: `${targetOrigin}${source.pathname}${source.search}` };
});

console.log(`checking ${urls.length} URLs from ${sitemapUrl} against ${targetOrigin}`);

// A 200 is only worth counting if it came back from the page that was asked
// for. Without these two checks a deployment that redirected every docs URL to
// its home page, or to the live site, would sail through this gate while
// serving none of the documentation.
const dropTrailingSlash = (pathname) =>
  pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;

const visit = async (url) => {
  const requested = new URL(url);
  const hops = [];
  let current = url;
  for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      // node fetch has no deadline of its own, so one stalled request would
      // hang the whole run.
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { status: response.status, hops };
      hops.push(`${response.status} -> ${location}`);
      const next = new URL(location, current);
      if (next.origin !== targetOrigin) {
        return { status: `redirect left ${targetOrigin}`, hops };
      }
      current = next.toString();
      continue;
    }
    if (response.status === 200) {
      // The only redirect we expect is the trailing-slash normalisation that
      // Cloudflare's `drop-trailing-slash` mode performs.
      const landed = new URL(current);
      if (dropTrailingSlash(landed.pathname) !== dropTrailingSlash(requested.pathname)) {
        return { status: `redirect changed the path to ${landed.pathname}`, hops };
      }
    }
    return { status: response.status, hops };
  }
  return { status: `more than ${MAX_HOPS} redirects`, hops };
};

const failures = [];
const redirected = [];
let done = 0;

const queue = [...urls];
const worker = async () => {
  for (;;) {
    const next = queue.shift();
    if (!next) return;
    try {
      const { status, hops } = await visit(next.url);
      if (status !== 200) failures.push({ ...next, status, hops });
      else if (hops.length > 0) redirected.push({ ...next, hops });
    } catch (error) {
      failures.push({ ...next, status: "network error", hops: [String(error)] });
    }
    done += 1;
    if (done % 100 === 0) console.log(`  ${done}/${urls.length}`);
  }
};

await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));

if (redirected.length > 0) {
  console.log(`\n${redirected.length} URL(s) reached 200 after a redirect:`);
  for (const item of redirected.slice(0, 25)) {
    console.log(`  ${item.url}\n    ${item.hops.join("\n    ")}`);
  }
  if (redirected.length > 25) console.log(`  ...and ${redirected.length - 25} more`);
}

if (failures.length > 0) {
  console.log(`\n${failures.length} URL(s) did NOT return 200:`);
  for (const item of failures) {
    console.log(`  [${item.status}] ${item.url}`);
    for (const hop of item.hops) console.log(`    ${hop}`);
  }
  console.log(`\nparity FAILED: ${failures.length}/${urls.length}`);
  process.exit(1);
}

console.log(`\nparity OK: ${urls.length}/${urls.length} returned 200`);

// Every URL returning 200 is necessary but not sufficient. A deployment that
// answered every request with the home page would also score 950 out of 950,
// and one that lost the _headers file would serve the whole site with the
// wrong cache policy. Check both before reporting success.
console.log("\nchecking deployment shape");
const shapeFailures = [];

const head = async (path) =>
  fetch(`${targetOrigin}${path}`, {
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });

// A page that cannot exist must 404, not fall back to something that works.
const missingPath = "/docs/this-page-does-not-exist-parity-probe";
try {
  const response = await head(missingPath);
  if (response.status !== 404) {
    shapeFailures.push(`${missingPath} returned ${response.status}, expected 404`);
  } else {
    console.log(`  missing page 404s`);
  }
} catch (error) {
  shapeFailures.push(`${missingPath} failed: ${error}`);
}

// HTML gets a short time to live so docs edits appear quickly. Hashed build
// assets get the immutable one-year policy. Both come from worker-assets/_headers.
const cacheChecks = [
  { what: "html", path: "/docs", expect: /max-age=60\b/ },
  { what: "hashed asset", path: null, expect: /immutable/ },
];

try {
  const home = await head("/docs");
  const html = await home.text();
  const asset = html.match(/\/docs\/assets\/js\/[A-Za-z0-9._-]+\.js/);
  cacheChecks[1].path = asset ? asset[0] : null;
} catch (error) {
  shapeFailures.push(`could not read /docs to find a hashed asset: ${error}`);
}

for (const check of cacheChecks) {
  if (!check.path) {
    shapeFailures.push(`could not find a ${check.what} to check the cache policy on`);
    continue;
  }
  try {
    const response = await head(check.path);
    const cacheControl = response.headers.get("cache-control") || "";
    if (!check.expect.test(cacheControl)) {
      shapeFailures.push(
        `${check.what} ${check.path} sent "cache-control: ${cacheControl}", expected ${check.expect}`,
      );
    } else {
      console.log(`  ${check.what} cache policy: ${cacheControl}`);
    }
  } catch (error) {
    shapeFailures.push(`${check.path} failed: ${error}`);
  }
}

if (shapeFailures.length > 0) {
  console.log(`\n${shapeFailures.length} deployment shape problem(s):`);
  for (const problem of shapeFailures) console.log(`  ${problem}`);
  console.log("\nparity FAILED on deployment shape");
  process.exit(1);
}

console.log("\nall checks passed");
