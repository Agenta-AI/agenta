// Builders for the markdown twin of every page.
//
// Each route has a prebuilt .md twin (src/pages/*.md.ts) that the edge worker
// serves when a client asks for `Accept: text/markdown` — see worker/index.ts.
// The twins are also directly fetchable (/pricing.md), which is how agents that
// do not negotiate can still read the site without running JavaScript.
import { SITE_URL } from "./siteSummary";

/** The footer every twin carries: where an agent goes from here. */
const MACHINE_READABLE = [
  { label: "Sitemap", href: `${SITE_URL}/sitemap-index.xml` },
  { label: "llms.txt", href: `${SITE_URL}/llms.txt` },
  { label: "OpenAPI specification", href: `${SITE_URL}/openapi.json` },
  { label: "Documentation", href: "https://docs.agenta.ai" },
];

export interface MarkdownPage {
  title: string;
  description: string;
  /** Path of the HTML page this document represents, e.g. "/pricing". */
  path: string;
  /** Markdown body, already formatted. */
  body: string;
}

/** Wrap a body in the standard heading, canonical link, and agent footer. */
export function page({ title, description, path, body }: MarkdownPage): string {
  const canonical = `${SITE_URL}${path === "/" ? "/" : path}`;
  const footer = MACHINE_READABLE.map(
    (link) => `- [${link.label}](${link.href})`,
  ).join("\n");

  return `# ${title}

${description}

Canonical HTML page: <${canonical}>

${body.trim()}

---

## Machine-readable

${footer}

Every page on ${SITE_URL} serves this representation when requested with
\`Accept: text/markdown\`.
`;
}

/**
 * A markdown response for the endpoint to return.
 *
 * Only the Content-Type is set here, and only `astro dev` reads it: a static
 * build keeps the body and drops the headers. Everything a deployed twin needs
 * comes from public/_headers (`/*.md` → noindex) or, on a negotiated request,
 * from worker/index.ts.
 */
export function markdownResponse(body: string): Response {
  return new Response(body, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}

/**
 * Turn an MDX post body into plain markdown.
 *
 * Posts import and use a handful of Astro components (InlineCTA, BlogImage).
 * Strip the imports, turn those images into real markdown images, and drop the
 * remaining component tags while keeping any text they wrap. Ordinary markdown
 * — headings, lists, tables, fenced code — passes through untouched.
 */
export function mdxToMarkdown(body: string): string {
  // Code may legitimately contain anything that looks like JSX (`<InlineCTA />`
  // in a sentence about the component, for instance). Pull every fenced block
  // and inline span out first, rewrite around them, then put them back.
  const code: string[] = [];
  const withoutCode = body
    .replace(/```[\s\S]*?```/g, (match) => {
      code.push(match);
      return ` CODE${code.length - 1} `;
    })
    .replace(/`[^`\n]*`/g, (match) => {
      code.push(match);
      return ` CODE${code.length - 1} `;
    });

  const rewritten = withoutCode
    // ESM imports at the top of a post.
    .replace(/^import\s.+?;?\s*$/gm, "")
    // BlogImage carries the real content: keep it as a markdown image.
    .replace(/<BlogImage\b([^>]*)\/>/g, (_match, attrs: string) => {
      const src = /src=["']([^"']+)["']/.exec(attrs)?.[1];
      const alt = /alt=["']([^"']*)["']/.exec(attrs)?.[1] ?? "";
      return src ? `![${alt}](${src})` : "";
    })
    // Any other self-closing component, e.g. the inline CTA.
    .replace(/<[A-Z][\w.]*\b[^>]*\/>/g, "")
    // Paired components: keep the text inside, drop the tags.
    .replace(/<\/?[A-Z][\w.]*\b[^>]*>/g, "")
    // Collapse the blank runs the removals leave behind.
    .replace(/\n{3,}/g, "\n\n");

  return rewritten
    .replace(/ CODE(\d+) /g, (_match, index: string) => code[Number(index)])
    .trim();
}
