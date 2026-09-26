// Markdown twin of the Agent Marketplace index — /marketplace.md. Flat filename
// for the same reason as blog.md.ts (the worker fetches "<path>.md").
import type { APIRoute } from "astro";
import { markdownResponse, page } from "../lib/markdown";
import { SITE_URL } from "../lib/siteSummary";
import {
  USE_IT_FOR_FREE_LABEL,
  templates,
  useItForFreeUrl,
} from "../lib/templates";
import {
  MARKETPLACE_NAME,
  MARKETPLACE_PATH,
  authorPath,
  categoriesOf,
  templatePath,
} from "../lib/marketplace";

export const GET: APIRoute = async () => {
  const body = categoriesOf(templates)
    .map(
      (category) => `## ${category}

${templates
  .filter((template) => template.category === category)
  .map(
    (template) =>
      `- [${template.name}](${SITE_URL}${templatePath(template.key)}) — ${template.summary} By [${template.author.name}](${SITE_URL}${authorPath(template.author.id)}). [${USE_IT_FOR_FREE_LABEL}](${useItForFreeUrl(template.key)})`,
  )
  .join("\n")}`,
    )
    .join("\n\n");

  return markdownResponse(
    page({
      title: MARKETPLACE_NAME,
      description:
        "Ready-to-run agent templates. Pick one and start it in Agenta for free.",
      path: MARKETPLACE_PATH,
      body,
    }),
  );
};
