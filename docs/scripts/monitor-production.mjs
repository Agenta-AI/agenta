import process from "node:process";

const origin = (process.env.DOCS_ORIGIN || "https://agenta.ai").replace(/\/$/, "");
const timeoutMs = 30_000;
const checks = [
  { path: "/docs/sitemap.xml", type: "application/xml" },
  { path: "/docs/", type: "text/html" },
  { path: "/docs/1.0/", type: "text/html" },
  { path: "/docs/administration/security/overview", type: "text/html" },
  { path: "/docs/reference/api/accept-invitation", type: "text/html" },
];
const agents = [
  ["browser", "agenta-docs-monitor/1.0"],
  ["googlebot", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"],
  ["bingbot", "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)"],
];

let failures = 0;
for (const { path, type } of checks) {
  for (const [agent, userAgent] of agents) {
    const response = await fetch(`${origin}${path}`, {
      headers: { "user-agent": userAgent },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const cacheControl = response.headers.get("cache-control") || "";
    const challenge = response.headers.get("x-vercel-mitigated");
    const contentType = response.headers.get("content-type") || "";
    const errors = [];

    if (response.status !== 200) errors.push(`HTTP ${response.status}`);
    if (challenge) errors.push(`x-vercel-mitigated: ${challenge}`);
    if (response.status !== 200 && /(?:s-maxage|max-age)\s*=\s*[1-9]/i.test(cacheControl)) {
      errors.push(`cacheable error (${cacheControl})`);
    }
    if (!contentType.toLowerCase().includes(type)) {
      errors.push(`expected ${type}, got ${contentType || "no content-type"}`);
    }

    if (errors.length) {
      failures += 1;
      console.error(`FAIL ${agent} ${path}: ${errors.join(", ")}`);
    } else {
      console.log(`PASS ${agent} ${path}`);
    }
  }
}

if (failures) {
  console.error(`${failures} docs health check(s) failed`);
  process.exit(1);
}
