// Thin edge worker in front of Cloudflare Workers Static Assets.
//
// The site itself stays pure SSG (astro.config.mjs `output: "static"`). This is
// NOT SSR: nothing is rendered here. The worker only looks at the request's
// Accept header, picks one of the PREBUILT representations of a page (the .html
// Astro emitted, or its .md twin), and sets the headers a machine client needs.
//
// Why it exists: agent-readiness. Static assets alone cannot do content
// negotiation, a Vary header, a 406, or a structured JSON error body.
//
// Two Cloudflare facts shape the design (see wrangler.jsonc):
//   1. `_headers` and `_redirects` are NOT applied to responses served by worker
//      code. So `run_worker_first` is an allowlist of the HTML routes that need
//      negotiation — everything else (images, fonts, /openapi.json, the four
//      308s in public/_redirects) keeps the plain asset path. Responses this
//      worker returns re-apply the `/*` policy from negotiate.ts `HEADERS`.
//      Unknown paths reach this worker because `not_found_handling` is "none";
//      with "404-page" the asset server would answer them itself and no agent
//      could ever get a markdown or JSON 404.
//   2. Cloudflare's CDN ignores Vary values other than Accept-Encoding, so the
//      markdown representation is marked private/no-store-ish to guarantee a
//      shared cache can never hand a markdown body to a browser.
//
// Every path is wrapped in a try/catch that falls back to the raw asset: a bug
// in negotiation must never be able to take the marketing site down.
import {
  HEADERS,
  errorJson,
  mdCandidates,
  notAcceptableJson,
  notFoundMarkdown,
  pickRepresentation,
} from "./negotiate";

// The entire Workers runtime surface this script uses.
interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handle(request, env);
    } catch {
      // Negotiation is a nicety; serving the site is not.
      return env.ASSETS.fetch(request);
    }
  },
};

async function handle(request: Request, env: Env): Promise<Response> {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return env.ASSETS.fetch(request);

  const url = new URL(request.url);
  const candidates = mdCandidates(url.pathname);
  // A path that names a file (asset, /llms.txt, /openapi.json) is never
  // negotiated — hand it straight to the asset server, headers untouched.
  if (!candidates) return env.ASSETS.fetch(request);

  const preference = pickRepresentation(request.headers.get("accept"));

  if (preference === "markdown") {
    const markdown = await fetchFirstAsset(env, url, candidates);
    if (markdown) return markdownResponse(await markdown.text(), method);
  }

  if (preference === "none") {
    return json(notAcceptableJson(url.pathname), 406, method);
  }

  const asset = await env.ASSETS.fetch(request);

  if (asset.status === 404) return notFound(env, url, preference, method);
  if (!isHtml(asset)) return asset;

  return htmlResponse(asset, candidates[0], method);
}

/** Try each markdown twin in turn; null when none of them exist. */
async function fetchFirstAsset(
  env: Env,
  url: URL,
  candidates: string[],
): Promise<Response | null> {
  for (const path of candidates) {
    const response = await env.ASSETS.fetch(
      new Request(new URL(path, url.origin).toString(), { method: "GET" }),
    );
    // A miss is a 404 response (not_found_handling: "none"), not a throw.
    if (response.status === 200) return response;
  }
  return null;
}

function isHtml(response: Response): boolean {
  return (response.headers.get("content-type") ?? "").includes("text/html");
}

/** HEAD must carry the headers of the GET, but no body. */
function body(content: string, method: string): string | null {
  return method === "HEAD" ? null : content;
}

function withPolicy(headers: Headers): Headers {
  for (const [name, value] of Object.entries(HEADERS)) headers.set(name, value);
  return headers;
}

/** The rendered page, plus the machine-readable affordances. */
function htmlResponse(
  asset: Response,
  markdownPath: string,
  method: string,
): Response {
  const headers = withPolicy(new Headers(asset.headers));
  headers.set("Vary", "Accept, Accept-Encoding");
  // Point agents that do not guess at the markdown twin (RFC 8288).
  headers.append("Link", `<${markdownPath}>; rel="alternate"; type="text/markdown"`);
  return new Response(method === "HEAD" ? null : asset.body, {
    status: asset.status,
    statusText: asset.statusText,
    headers,
  });
}

function markdownResponse(content: string, method: string): Response {
  return new Response(body(content, method), {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      Vary: "Accept, Accept-Encoding",
      // Cloudflare ignores Vary: Accept when caching, so the markdown variant
      // must never enter a shared cache under the HTML URL.
      "Cache-Control": "private, max-age=0, must-revalidate",
      // The HTML page is the canonical, indexable representation.
      "X-Robots-Tag": "noindex",
      "X-Content-Type-Options": HEADERS["X-Content-Type-Options"],
      "Referrer-Policy": HEADERS["Referrer-Policy"],
    },
  });
}

function json(content: string, status: number, method: string): Response {
  return new Response(body(content, method), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Vary: "Accept, Accept-Encoding",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": HEADERS["X-Content-Type-Options"],
    },
  });
}

/**
 * A dead end, answered in the caller's own language.
 *
 * A wildcard Accept and a missing Accept deliberately get the designed HTML
 * page: that is curl, every uptime monitor, every link checker, and this repo's
 * own CI verification step. acceptmarkdown.com only asks for markdown when
 * markdown was actually requested.
 */
async function notFound(
  env: Env,
  url: URL,
  preference: string,
  method: string,
): Promise<Response> {
  if (preference === "json" || url.pathname.startsWith("/api/")) {
    return json(
      errorJson(404, "not_found", "No resource exists at this path.", url.pathname, [
        "Fetch /sitemap-index.xml for every indexable URL.",
        "Fetch /llms.txt for a short description of the site.",
        "Fetch /openapi.json for the Agenta API surface.",
        "The Agenta API is served from us.cloud.agenta.ai and eu.cloud.agenta.ai, not from agenta.ai.",
      ]),
      404,
      method,
    );
  }

  if (preference === "markdown") {
    return new Response(body(notFoundMarkdown(url.pathname), method), {
      status: 404,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        Vary: "Accept, Accept-Encoding",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex",
      },
    });
  }

  // Humans and crawlers keep the designed 404 page, unchanged. It is a normal
  // asset (dist/404.html); we fetch it and re-stamp the 404 status.
  const page = await env.ASSETS.fetch(
    new Request(new URL("/404.html", url.origin).toString(), { method: "GET" }),
  );
  const headers = withPolicy(new Headers(page.headers));
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Vary", "Accept, Accept-Encoding");
  headers.set("Cache-Control", "no-store");
  return new Response(method === "HEAD" ? null : page.body, {
    status: 404,
    headers,
  });
}
