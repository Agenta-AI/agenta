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
import {
  appsOf,
  authorPath,
  howItWorksOf,
  relatedTemplatesOf,
  requirementsOf,
  setupStepsOf,
  templatePath,
} from "../../lib/marketplace";

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

  const apps = appsOf(template).map((app) => app.name);
  const list = (items: string[]) => items.map((item) => `- ${item}`).join("\n");
  const numbered = (items: string[]) =>
    items.map((item, i) => `${i + 1}. ${item}`).join("\n");
  const related = relatedTemplatesOf(template, templates);
  const steps = howItWorksOf(template);

  const sections = [
    `## Overview\n\n${template.description}`,
    steps.length > 0 && `## How it works\n\n${numbered(steps)}`,
    template.example &&
      `## Example output\n\n${template.example.prompt}\n\n${numbered(template.example.steps)}\n\n${template.example.reply}`,
    `## How to set this up\n\n${numbered(
      setupStepsOf(template).map((step) => `${step.title}. ${step.text}`),
    )}`,
    `## What it needs\n\n${list(
      requirementsOf(template).map(
        (req) => `${req.label}${req.note ? ` (${req.note})` : ""}`,
      ),
    )}`,
    apps.length > 0 && `## Apps\n\n${apps.join(", ")}`,
    related.length > 0 &&
      `## Related templates\n\n${list(
        related.map(
          (other) => `[${other.name}](${SITE_URL}${templatePath(other.key)})`,
        ),
      )}`,
  ].filter(Boolean);

  const body = `[${USE_IT_FOR_FREE_LABEL}](${useItForFreeUrl(template.key)})

${facts.join("\n")}

${sections.join("\n\n")}
`;

  return markdownResponse(
    page({
      title: template.name,
      description: template.summary,
      path: templatePath(template.key),
      body,
    }),
  );
};
