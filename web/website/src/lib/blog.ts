// Shared blog helpers — kept in code (not content) per CONTENT_MODEL.md.
import type { CollectionEntry } from "astro:content";

export type Post = CollectionEntry<"posts">;
export type Author = CollectionEntry<"authors">;

// Category → card thumbnail tint (the gradient fallback shown when a post has no
// hero image, and as the base behind hero images). Verbatim from CONTENT_MODEL.md.
const CATEGORY_GRADIENT: Record<string, string> = {
  Engineering: "linear-gradient(150deg,#15181C,#101113)",
  Article: "linear-gradient(150deg,#211D1B,#131214)",
};

export function categoryGradient(category: string): string {
  return CATEGORY_GRADIENT[category] ?? CATEGORY_GRADIENT.Article;
}

// Display format `MMM D, YYYY` (e.g. "Feb 11, 2026"). Store ISO, format in view.
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function formatDate(date: Date): string {
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

// Most-recent first.
export function byDateDesc(a: Post, b: Post): number {
  return b.data.date.getTime() - a.data.date.getTime();
}

// Social platform → the generic brand icon shipped under /public/icons
// (the icons the site footer uses). Unknown platforms fall back to x.
const SOCIAL_ICON: Record<string, string> = {
  x: "/icons/social-1.svg",
  twitter: "/icons/social-1.svg",
  linkedin: "/icons/social-linkedin.svg",
  github: "/icons/social-3.svg",
  slack: "/icons/social-4.svg",
  youtube: "/icons/social-5.svg",
};

export function socialIcon(platform: string): string {
  return SOCIAL_ICON[platform.toLowerCase()] ?? SOCIAL_ICON.x;
}

// --- Authors (primary + optional co-authors) -------------------------------
//
// The live site shows multi-author bylines and lists a co-authored post on every
// contributor's author page. `author` is the primary (byline order: primary
// first); `coAuthors` is the optional rest. These helpers centralise the
// "primary OR co-author" logic so the post page, author page, and author index
// all agree.

// All author references on a post, primary first, de-duplicated. Returns the
// reference objects ({ collection, id }); resolve to entries with getEntry.
export function authorRefs(post: Post) {
  const refs = [post.data.author, ...(post.data.coAuthors ?? [])];
  const seen = new Set<string>();
  return refs.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}

// True if the given author id contributed to the post (primary OR co-author).
export function isAuthorOf(post: Post, authorId: string): boolean {
  return authorRefs(post).some((r) => r.id === authorId);
}

// Posts an author contributed to (primary OR co-author), most-recent first.
export function authorPosts(authorId: string, all: Post[]): Post[] {
  return all.filter((p) => isAuthorOf(p, authorId)).sort(byDateDesc);
}

// --- Legacy-era posts ------------------------------------------------------
//
// Posts published before the July 2026 relaunch describe the earlier Agenta
// product (prompt management, evaluation, and LLM observability for LLM apps).
// Those posts keep their publication dates and content untouched; the post page
// and its markdown twin both render a dated update note on them so readers and
// crawlers get the current definition of Agenta next to the historical text.
export const LEGACY_ERA_END = new Date("2026-07-01T00:00:00Z");

export function isLegacyPost(post: Post): boolean {
  return post.data.date.getTime() < LEGACY_ERA_END.getTime();
}

// The note's text, shared verbatim between the HTML notice component and the
// markdown twin so the two representations never drift.
export const LEGACY_NOTICE_DATE = "Sep 28, 2026";
export const LEGACY_NOTICE_TEXT =
  "This post is from an earlier era of Agenta, when the product focused on prompt management, evaluation, and LLM observability. Agenta is now the open-source workspace for your agents: build AI coworkers through chat, improve them with feedback, and share them with your whole team, self-hosted or in the cloud.";
export const LEGACY_NOTICE_LINK_LABEL = "See what Agenta is today";
export const LEGACY_NOTICE_LINK_HREF = "https://agenta.ai/";

// Related posts: same category, most recent, excluding the current post, max 4.
// Falls back to filling with other recent posts if the category is thin.
export function relatedPosts(current: Post, all: Post[], limit = 4): Post[] {
  const others = all.filter((p) => p.id !== current.id).sort(byDateDesc);
  const sameCategory = others.filter(
    (p) => p.data.category === current.data.category,
  );
  const picks = [...sameCategory];
  if (picks.length < limit) {
    for (const p of others) {
      if (picks.length >= limit) break;
      if (!picks.includes(p)) picks.push(p);
    }
  }
  return picks.slice(0, limit);
}
