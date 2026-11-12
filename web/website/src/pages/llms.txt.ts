// Dynamic llms.txt — served at /llms.txt, mirroring src/pages/robots.txt.ts.
//
// Follows the llms.txt convention (https://llmstxt.org): a short, factual map of
// the site for LLMs and AI crawlers, which we allow (see robots.txt.ts). The
// copy lives in src/lib/siteSummary.ts so this file and the homepage markdown
// twin (index.md.ts) can never drift apart.
import type { APIRoute } from "astro";
import { templates } from "../lib/templates";
import {
  ABOUT,
  API,
  CAPABILITIES,
  GLOSSARY,
  HOSTING,
  HOW_TO_CALL,
  LINKS,
  POSITIONING,
  SITE_URL,
  TAGLINE,
  WHEN_NOT_TO_USE,
  WHEN_TO_USE,
} from "../lib/siteSummary";

const quoted = TAGLINE.split("\n")
  .map((line) => `> ${line}`)
  .join("\n");

// Templates grouped by catalog category, generated so the list never goes stale.
const byCategory = new Map<string, typeof templates>();
for (const t of templates) byCategory.set(t.category, [...(byCategory.get(t.category) ?? []), t]);
const templateList = [...byCategory.entries()]
  .sort((a, b) => b[1].length - a[1].length)
  .map(
    ([category, list]) =>
      `### ${category}\n\n` +
      list.map((t) => `- [${t.name}](${SITE_URL}/marketplace/${t.key}): ${t.summary}`).join("\n"),
  )
  .join("\n\n");

const body = `# Agenta: ${POSITIONING}

${quoted}

## About

${ABOUT.map((item) => `- ${item}`).join("\n")}

## Capabilities

${CAPABILITIES.map((item) => `- ${item}`).join("\n")}

## Glossary

${GLOSSARY.map((item) => `- ${item}`).join("\n")}

## When to use Agenta

${WHEN_TO_USE.map((item) => `- ${item}`).join("\n")}

## When not to use Agenta

${WHEN_NOT_TO_USE.map((item) => `- ${item}`).join("\n")}

## How to call Agenta

${HOW_TO_CALL.map((item) => `- ${item}`).join("\n")}

## Links

${LINKS.map((link) => `- [${link.label}](${link.href}): ${link.note}.`).join("\n")}

## Templates

${templates.length} ready-made agents. Each links to its page; append \`.md\` for markdown.

${templateList}

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
