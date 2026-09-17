// Markdown twin of every author profile — /authors/<slug>.md.
import type { APIRoute, GetStaticPaths } from "astro";
import { getCollection } from "astro:content";
import { markdownResponse, page } from "../../lib/markdown";
import { authorPosts, byDateDesc, formatDate } from "../../lib/blog";
import { SITE_URL } from "../../lib/siteSummary";

export const getStaticPaths = (async () => {
  const authors = await getCollection("authors");
  const posts = await getCollection("posts");
  return authors.map((author) => ({
    params: { slug: author.id },
    props: { author, posts: authorPosts(author.id, posts).sort(byDateDesc) },
  }));
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props }) => {
  const { author, posts } = props as {
    author: Awaited<ReturnType<typeof getCollection<"authors">>>[number];
    posts: Awaited<ReturnType<typeof getCollection<"posts">>>;
  };
  const { name, role, bio, socials } = author.data;

  const links = socials?.length
    ? `\n\n## Elsewhere\n\n${socials
        .map((social) => `- [${social.platform}](${social.url})`)
        .join("\n")}`
    : "";

  const body = `${bio ? `${bio}\n\n` : ""}Role: ${role}

## Posts

${posts
  .map(
    (post) =>
      `- [${post.data.title}](${SITE_URL}/blog/${post.id}) — ${formatDate(post.data.date)}`,
  )
  .join("\n")}${links}
`;

  return markdownResponse(
    page({
      title: name,
      description: bio ?? `${name} — ${role}. Posts on the Agenta blog.`,
      path: `/authors/${author.id}`,
      body,
    }),
  );
};
