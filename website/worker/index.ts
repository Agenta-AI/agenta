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
//      markdown representation is marked private so a shared cache can never
//      hand a markdown body to a browser.
//
// Every path is wrapped in a try/catch that falls back to the raw asset: a bug
// in negotiation must never be able to take the marketing site down.
import {
  HEADERS,
  acceptedRepresentations,
  errorJson,
  mdPath,
  notAcceptableJson,
  notFoundMarkdown,
  type Representation,
} from "./negotiate";

// The entire Workers runtime surface this script uses.
interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const MARKDOWN = "text/markdown; charset=utf-8";
const JSON_TYPE = "application/json; charset=utf-8";

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
  const twin = mdPath(url.pathname);
  // A path that names a file (asset, /llms.txt, /openapi.json, a .md twin) is
  // never negotiated — hand it straight to the asset server, headers untouched.
  if (!twin) return env.ASSETS.fetch(request);

  const accepted = acceptedRepresentations(request.headers.get("accept"));

  // Serve markdown when the client ranks it above HTML (or asks for it and not
  // HTML at all). A client that prefers JSON but also takes markdown gets the
  // twin, not HTML it never asked for; a page has no JSON representation.
  for (const representation of accepted) {
    if (representation === "html") break;
    if (representation !== "markdown") continue;

    const markdown = await getAsset(env, url, twin);
    if (markdown) {
      return respond(await markdown.text(), method, {
        type: MARKDOWN,
        // The HTML page is the canonical, indexable representation.
        cache: "private, max-age=0, must-revalidate",
        extra: { "X-Robots-Tag": "noindex" },
      });
    }
  }

  // Fetch the page before deciding: a path that does not exist owes the client
  // a 404 in its own language, not a 406 about representations of nothing.
  const asset = await env.ASSETS.fetch(request);
  if (asset.status === 404) return notFound(env, url, accepted, method);

  if (!accepted.includes("html")) {
    // The page exists, but not in a shape this client will take.
    return respond(notAcceptableJson(url.pathname), method, {
      status: 406,
      type: JSON_TYPE,
      cache: "no-store",
    });
  }

  return rewrap(asset, method, {
    // Point agents that do not guess at the markdown twin (RFC 8288).
    Link: `<${twin}>; rel="alternate"; type="text/markdown"`,
  });
}

/** Fetch one asset by path; null when it does not exist. */
async function getAsset(
  env: Env,
  url: URL,
  path: string,
): Promise<Response | null> {
  const response = await env.ASSETS.fetch(
    new Request(new URL(path, url.origin).toString(), { method: "GET" }),
  );
  // A miss is a 404 response (not_found_handling: "none"), not a throw.
  return response.status === 200 ? response : null;
}

/**
 * A response this worker composes itself.
 *
 * `_headers` does not reach worker responses, so the site-wide policy is
 * re-applied here; `Vary: Accept` is what makes the negotiation honest.
 */
function respond(
  body: string,
  method: string,
  options: {
    status?: number;
    type: string;
    cache: string;
    extra?: Record<string, string>;
  },
): Response {
  return new Response(method === "HEAD" ? null : body, {
    status: options.status ?? 200,
    headers: {
      ...HEADERS,
      "Content-Type": options.type,
      "Cache-Control": options.cache,
      Vary: "Accept, Accept-Encoding",
      ...options.extra,
    },
  });
}

/** An asset the worker passes through, with the same headers added. */
function rewrap(
  asset: Response,
  method: string,
  extra: Record<string, string>,
  status = asset.status,
): Response {
  const headers = new Headers(asset.headers);
  for (const [name, value] of Object.entries({ ...HEADERS, ...extra })) {
    headers.set(name, value);
  }
  headers.set("Vary", "Accept, Accept-Encoding");
  return new Response(method === "HEAD" ? null : asset.body, {
    status,
    headers,
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
  accepted: Representation[],
  method: string,
): Promise<Response> {
  // Answer in the first language the client named. /api/* has no HTML
  // representation to fall back on, so it is always JSON.
  const preference = url.pathname.startsWith("/api/")
    ? "json"
    : (accepted[0] ?? "html");

  if (preference === "json") {
    return respond(
      errorJson({
        status: 404,
        code: "not_found",
        message: "No resource exists at this path.",
        path: url.pathname,
        hints: [
          "Fetch /sitemap-index.xml for every indexable URL.",
          "Fetch /llms.txt for a short description of the site.",
          "Fetch /openapi.json for the Agenta API surface.",
          "The Agenta API is served from us.cloud.agenta.ai and eu.cloud.agenta.ai, not from agenta.ai.",
        ],
      }),
      method,
      { status: 404, type: JSON_TYPE, cache: "no-store" },
    );
  }

  if (preference === "markdown") {
    return respond(notFoundMarkdown(url.pathname), method, {
      status: 404,
      type: MARKDOWN,
      cache: "no-store",
      extra: { "X-Robots-Tag": "noindex" },
    });
  }

  // Humans and crawlers keep the designed 404 page, unchanged. It is a normal
  // asset (dist/404.html); we fetch it and re-stamp the 404 status.
  const page = await env.ASSETS.fetch(
    new Request(new URL("/404.html", url.origin).toString(), { method: "GET" }),
  );
  return rewrap(page, method, { "Cache-Control": "no-store" }, 404);
}
