// Dynamic llms.txt — served at /llms.txt, mirroring src/pages/robots.txt.ts.
//
// Follows the llms.txt convention (https://llmstxt.org): a short, factual map of
// the site for LLMs and AI crawlers, which we allow (see robots.txt.ts). The
// copy lives in src/lib/siteSummary.ts so this file and the homepage markdown
// twin (index.md.ts) can never drift apart.
import type { APIRoute } from "astro";
import {
  ABOUT,
  API,
  HOSTING,
  LINKS,
  SITE_URL,
  TAGLINE,
} from "../lib/siteSummary";

const quoted = TAGLINE.split("\n")
  .map((line) => `> ${line}`)
  .join("\n");

const body = `# Agenta

${quoted}

## About

${ABOUT.map((item) => `- ${item}`).join("\n")}

## Links

${LINKS.map((link) => `- [${link.label}](${link.href}): ${link.note}.`).join("\n")}

## Hosting

${HOSTING.map((item) => `- ${item}`).join("\n")}

## API

${API.map((item) => `- ${item}`).join("\n")}

## Machine-readable

- Sitemap: ${SITE_URL}/sitemap-index.xml
- Every page also serves a markdown representation: request it with \`Accept: text/markdown\`, or append \`.md\` to the path (the homepage twin is \`/index.md\`).
`;

export const GET: APIRoute = () =>
  new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
