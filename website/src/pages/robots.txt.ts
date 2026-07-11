// Dynamic robots.txt — overrides public/robots.txt at build time.
//
// When PUBLIC_NOINDEX=true (test/preview deploys), emits a disallow-all body so
// crawlers never index the preview. Default (unset) = normal allow-all + sitemap.
// The matching noindex <meta> tag is emitted in src/layouts/Base.astro.
// Document the var in .env.example if it isn't there already.
import type { APIRoute } from "astro";

export const GET: APIRoute = () => {
  const noindex = import.meta.env.PUBLIC_NOINDEX === "true";

  const body = noindex
    ? "User-agent: *\nDisallow: /"
    : "# Agenta marketing site (https://agenta.ai)\n# Allow all crawlers full access; point them at the generated sitemap index.\nUser-agent: *\nAllow: /\n\nSitemap: https://agenta.ai/sitemap-index.xml\n";

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
