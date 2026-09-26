// Markdown twin of every author profile — /authors/<slug>.md.
// Covers blog authors and Agent Marketplace template authors (one id, one page).
import type { APIRoute, GetStaticPaths } from "astro";
import { getCollection } from "astro:content";
import { markdownResponse, page } from "../../lib/markdown";
import { authorPosts, byDateDesc, formatDate } from "../../lib/blog";
import { SITE_URL } from "../../lib/siteSummary";
import {
  authors as templateAuthors,
  templatesByAuthor,
} from "../../lib/templates";
import {
  MARKETPLACE_NAME,
  mergeAuthorProfiles,
  templatePath,
  type AuthorProfile,
} from "../../lib/marketplace";

export const getStaticPaths = (async () => {
  const blogAuthors = await getCollection("authors");
  const posts = await getCollection("posts");
  const blogIds = new Set(blogAuthors.map((author) => author.id));
  return mergeAuthorProfiles(blogAuthors, templateAuthors).map((profile) => ({
    params: { slug: profile.id },
    props: {
      profile,
      isBlogAuthor: blogIds.has(profile.id),
      posts: authorPosts(profile.id, posts).sort(byDateDesc),
    },
  }));
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props }) => {
  const { profile, isBlogAuthor, posts } = props as {
    profile: AuthorProfile;
    isBlogAuthor: boolean;
    posts: Awaited<ReturnType<typeof getCollection<"posts">>>;
  };
  const { name, role, bio, links } = profile;
  const templates = templatesByAuthor(profile.id);

  const sections: string[] = [];
  if (bio) sections.push(bio);
  if (role) sections.push(`Role: ${role}`);
  if (templates.length > 0) {
    sections.push(`## Templates on the ${MARKETPLACE_NAME}

${templates
  .map(
    (template) =>
      `- [${template.name}](${SITE_URL}${templatePath(template.key)}) — ${template.summary}`,
  )
  .join("\n")}`);
  }
  if (isBlogAuthor) {
    sections.push(`## Posts

${posts
  .map(
    (post) =>
      `- [${post.data.title}](${SITE_URL}/blog/${post.id}) — ${formatDate(post.data.date)}`,
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
        bio ??
        (role
          ? `${name} — ${role}. Posts on the Agenta blog.`
          : `${name} — agent templates on the ${MARKETPLACE_NAME}.`),
      path: `/authors/${profile.id}`,
      body: `${sections.join("\n\n")}\n`,
    }),
  );
};
