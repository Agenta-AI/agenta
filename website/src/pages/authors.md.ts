// Markdown twin of the authors index — /authors.md. Flat filename for the same
// reason as blog.md.ts (the worker fetches "<path>.md").
import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { markdownResponse, page } from "../lib/markdown";
import { authorPosts } from "../lib/blog";
import { SITE_URL } from "../lib/siteSummary";

export const GET: APIRoute = async () => {
  const authors = await getCollection("authors");
  const posts = await getCollection("posts");

  const body = `## Authors

${authors
  .map((author) => {
    const count = authorPosts(author.id, posts).length;
    return `- [${author.data.name}](${SITE_URL}/authors/${author.id}) — ${author.data.role}. ${count} post${count === 1 ? "" : "s"}.`;
  })
  .join("\n")}
`;

  return markdownResponse(
    page({
      title: "Authors",
      description: "The people writing on the Agenta blog.",
      path: "/authors",
      body,
    }),
  );
};
