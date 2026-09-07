// Markdown twin of every blog post — /blog/<slug>.md.
//
// The body is the post's own MDX source with the component tags stripped, so an
// agent reads exactly what a reader reads, without running any JavaScript.
import type { APIRoute, GetStaticPaths } from "astro";
import { getCollection, getEntry } from "astro:content";
import { markdownResponse, mdxToMarkdown, page } from "../../lib/markdown";
import { authorRefs, formatDate } from "../../lib/blog";

export const getStaticPaths = (async () => {
  const posts = await getCollection("posts");
  return posts.map((post) => ({ params: { slug: post.id }, props: { post } }));
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props }) => {
  const { post } = props as { post: Awaited<ReturnType<typeof getCollection<"posts">>>[number] };

  const authors = (
    await Promise.all(authorRefs(post).map((ref) => getEntry(ref)))
  ).filter((author): author is NonNullable<typeof author> => Boolean(author));

  const byline = authors.map((author) => author.data.name).join(", ");
  const meta = [
    `Category: ${post.data.category}`,
    `Published: ${formatDate(post.data.date)}`,
    byline ? `Author: ${byline}` : null,
    post.data.tags?.length ? `Tags: ${post.data.tags.join(", ")}` : null,
  ]
    .filter(Boolean)
    .map((line) => `- ${line}`)
    .join("\n");

  return markdownResponse(
    page({
      title: post.data.title,
      description: post.data.description,
      path: `/blog/${post.id}`,
      body: `${meta}\n\n${mdxToMarkdown(post.body ?? "")}`,
    }),
  );
};
