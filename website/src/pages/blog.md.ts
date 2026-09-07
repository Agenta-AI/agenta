// Markdown twin of the blog index — /blog.md.
//
// The filename is flat (blog.md.ts, not blog/index.md.ts) on purpose: the edge
// worker asks ASSETS for "<path>.md", so the twin of /blog must be /blog.md.
import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { markdownResponse, page } from "../lib/markdown";
import { byDateDesc, formatDate } from "../lib/blog";
import { SITE_URL } from "../lib/siteSummary";

export const GET: APIRoute = async () => {
  const posts = (await getCollection("posts")).sort(byDateDesc);

  const body = `## All posts

${posts
  .map(
    (post) =>
      `- [${post.data.title}](${SITE_URL}/blog/${post.id}) — ${post.data.category}, ${formatDate(post.data.date)}. ${post.data.description}`,
  )
  .join("\n")}
`;

  return markdownResponse(
    page({
      title: "Agenta Blog",
      description:
        "Articles and engineering posts from the Agenta team on building, evaluating, and shipping AI agents.",
      path: "/blog",
      body,
    }),
  );
};
