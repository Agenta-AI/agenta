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
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function formatDate(date: Date): string {
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

// Most-recent first.
export function byDateDesc(a: Post, b: Post): number {
  return b.data.date.getTime() - a.data.date.getTime();
}

// Social platform → the generic brand icon shipped under /public/icons
// (mapping from site.json footer socials). Unknown platforms fall back to x.
const SOCIAL_ICON: Record<string, string> = {
  x: "/icons/social-1.svg",
  twitter: "/icons/social-1.svg",
  linkedin: "/icons/social-2.svg",
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
