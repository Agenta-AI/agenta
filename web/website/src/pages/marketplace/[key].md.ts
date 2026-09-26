// Markdown twin of every template page — /marketplace/<key>.md.
import type { APIRoute, GetStaticPaths } from "astro";
import { markdownResponse, page } from "../../lib/markdown";
import { SITE_URL } from "../../lib/siteSummary";
import {
  USE_IT_FOR_FREE_LABEL,
  templates,
  useItForFreeUrl,
  type WebsiteTemplate,
} from "../../lib/templates";
import { authorPath, templatePath } from "../../lib/marketplace";

export const getStaticPaths = (() =>
  templates.map((template) => ({
    params: { key: template.key },
    props: { template },
  }))) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props }) => {
  const { template } = props as { template: WebsiteTemplate };

  const facts = [
    `- Category: ${template.category}`,
    `- Author: [${template.author.name}](${SITE_URL}${authorPath(template.author.id)})`,
    template.trigger && `- Trigger: ${template.trigger}`,
    template.tools_summary && `- Tools: ${template.tools_summary}`,
    `- Version: ${template.version}`,
  ].filter(Boolean);

  const connections = template.connections.map((connection) => {
    const app = connection.primary
      ? ` — ${connection.primary.slug}${connection.primary.scope ? ` (${connection.primary.scope})` : ""}`
      : "";
    return `- ${connection.role}${connection.required ? "" : " (optional)"}${app}`;
  });

  const body = `[${USE_IT_FOR_FREE_LABEL}](${useItForFreeUrl(template.key)})

${facts.join("\n")}

## What it does

${template.description}
${template.trigger_description ? `\n## When it runs\n\n${template.trigger_description}\n` : ""}${
    connections.length > 0
      ? `\n## What it connects to\n\n${connections.join("\n")}\n`
      : ""
  }`;

  return markdownResponse(
    page({
      title: template.name,
      description: template.summary,
      path: templatePath(template.key),
      body,
    }),
  );
};
