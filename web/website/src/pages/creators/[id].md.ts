// Markdown twin of every Agent Marketplace creator page — /creators/<id>.md.
import type { APIRoute, GetStaticPaths } from "astro";
import { markdownResponse, page } from "../../lib/markdown";
import { SITE_URL } from "../../lib/siteSummary";
import {
  authors as templateAuthors,
  templatesByAuthor,
} from "../../lib/templates";
import {
  MARKETPLACE_NAME,
  authorPath,
  authorProfiles,
  templatePath,
  type AuthorProfile,
} from "../../lib/marketplace";

export const getStaticPaths = (() =>
  authorProfiles(templateAuthors).map((profile) => ({
    params: { id: profile.id },
    props: { profile },
  }))) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props }) => {
  const { profile } = props as { profile: AuthorProfile };
  const { name, bio, links } = profile;
  const templates = templatesByAuthor(profile.id);

  const sections: string[] = [];
  if (bio) sections.push(bio);
  if (templates.length > 0) {
    sections.push(`## Templates on the ${MARKETPLACE_NAME}

${templates
  .map(
    (template) =>
      `- [${template.name}](${SITE_URL}${templatePath(template.key)}) — ${template.summary}`,
  )
  .join("\n")}`);
  }
  if (links.length > 0) {
    sections.push(`## Elsewhere

${links.map((link) => `- [${link.label}](${link.url})`).join("\n")}`);
  }

  return markdownResponse(
    page({
      title: name,
      description:
        bio ?? `${name} — agent templates on the ${MARKETPLACE_NAME}.`,
      path: authorPath(profile.id),
      body: `${sections.join("\n\n")}\n`,
    }),
  );
};
