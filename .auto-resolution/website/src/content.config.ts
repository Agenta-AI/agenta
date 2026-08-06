// Content collections for the blog.
//
// Two collections, both backed by the already-migrated files (see
// docs/design/marketing-website/research/blog-migration.md):
//   - posts:   src/content/posts/*.mdx   (37 posts)
//   - authors: src/content/authors/*.json (3 authors)
//
// The Zod schemas mirror `Agenta landing page pivot/handoff/CONTENT_MODEL.md`.
// Every required field present in all 37 migrated posts is validated strictly;
// fields that vary or were inferred during migration are optional so migration
// variance never breaks the build. `.passthrough()` keeps any extra frontmatter
// rather than rejecting it.
import { defineCollection, reference, z } from "astro:content";
import { glob } from "astro/loaders";

const posts = defineCollection({
  // Glob loader → entry id = filename without extension = the URL slug.
  loader: glob({ pattern: "**/*.mdx", base: "./src/content/posts" }),
  schema: z
    .object({
      slug: z.string(),
      title: z.string(),
      description: z.string(),
      // Taxonomy is exactly two categories on the live blog (19 Article / 18
      // Engineering). Drives the filter pills + the card thumbnail tint.
      category: z.enum(["Article", "Engineering"]),
      // Stored as ISO; `z.coerce.date()` accepts the YAML date scalar too.
      date: z.coerce.date(),
      // Primary author (drives the canonical byline order: primary first).
      author: reference("authors"),
      // Optional co-authors. The live site shows multi-author bylines for the
      // guest-written RAG/eval posts; a co-authored post appears on BOTH the
      // primary author's page AND every co-author's page (see authorPosts in
      // lib/blog.ts and the /authors/[slug] route). Stored as references so the
      // same author collection is the single source of truth.
      coAuthors: z.array(reference("authors")).optional(),
      // Images live under /public and are referenced by absolute path string
      // (not Astro's image() helper). Optional so a future post without a hero
      // still validates — the card falls back to a category-tinted gradient.
      heroImage: z.string().optional(),
      ogImage: z.string().optional(),
      // Featured: the blog index shows 1 primary (rank 1) + 2 secondary (ranks
      // 2-3). Only the 3 featured posts carry `featuredRank`.
      featured: z.boolean().default(false),
      featuredRank: z.number().optional(),
      // Auto-computed during migration (~238 wpm); optional + not authoritative.
      readingTime: z.string().optional(),
      tags: z.array(z.string()).optional(),
    })
    .passthrough(),
});

const authors = defineCollection({
  loader: glob({ pattern: "**/*.json", base: "./src/content/authors" }),
  schema: z
    .object({
      slug: z.string(),
      name: z.string(),
      role: z.string(),
      avatar: z.string(),
      bio: z.string().optional(),
      socials: z
        .array(z.object({ platform: z.string(), url: z.string() }))
        .optional(),
    })
    .passthrough(),
});

export const collections = { posts, authors };
