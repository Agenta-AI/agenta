import { describe, expect, it } from "vitest";

import {
  authorPath,
  categoriesOf,
  categorySlug,
  mergeAuthorProfiles,
  renderableMedia,
  templatePath,
  youtubeEmbedUrl,
} from "./marketplace";
import { authors, templates, templatesByAuthor } from "./templates";

describe("marketplace routes", () => {
  it("gives every template a detail page and every author a profile page", () => {
    expect(templatePath("pr-reviewer")).toBe("/marketplace/pr-reviewer");
    expect(authorPath("agenta")).toBe("/authors/agenta");
  });

  it("lists categories once, in catalog order", () => {
    const categories = categoriesOf(templates);
    expect(new Set(categories).size).toBe(categories.length);
    expect(categories[0]).toBe(templates[0]!.category);
    expect(categorySlug("Sales & Marketing")).toBe("sales-marketing");
  });
});

describe("template media", () => {
  it("renders images and videos in catalog order and skips the rest", () => {
    const items = renderableMedia(
      [
        { kind: "image", url: "https://assets.agenta.ai/a.png", alt: "Run" },
        { kind: "video", url: "https://youtu.be/dQw4w9WgXcQ", alt: null },
        {
          kind: "video",
          url: "https://assets.agenta.ai/b.mp4",
          poster_url: "https://assets.agenta.ai/b.jpg",
          caption: " A run ",
        },
        { kind: "audio", url: "https://assets.agenta.ai/c.mp3" },
        { kind: "image", url: "javascript:alert(1)" },
        { kind: "image", url: "" },
      ],
      "PR reviewer",
    );
    expect(items).toEqual([
      {
        kind: "image",
        url: "https://assets.agenta.ai/a.png",
        alt: "Run",
        caption: undefined,
      },
      {
        kind: "youtube",
        embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
        url: "https://youtu.be/dQw4w9WgXcQ",
        alt: "PR reviewer",
        caption: undefined,
      },
      {
        kind: "video",
        url: "https://assets.agenta.ai/b.mp4",
        alt: "PR reviewer",
        caption: "A run",
        posterUrl: "https://assets.agenta.ai/b.jpg",
      },
    ]);
  });

  it("falls back to nothing when a template has no media", () => {
    expect(renderableMedia([], "x")).toEqual([]);
    expect(renderableMedia(undefined, "x")).toEqual([]);
  });

  it("only embeds real YouTube video ids", () => {
    expect(youtubeEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
    expect(youtubeEmbedUrl("https://youtube.com/shorts/dQw4w9WgXcQ")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
    expect(youtubeEmbedUrl("https://vimeo.com/123456")).toBeNull();
    expect(youtubeEmbedUrl("https://youtube.com/watch")).toBeNull();
  });
});

describe("author profiles", () => {
  const blogAuthor = {
    id: "jane",
    data: {
      name: "Jane Doe",
      role: "Engineer",
      avatar: "/authors/jane.webp",
      socials: [{ platform: "github", url: "https://github.com/jane" }],
    },
  };
  const templateAuthor = (id: string, name: string) => ({
    schema_version: 1,
    id,
    name,
    bio: `${name} builds agents.`,
    links: [
      { kind: "github", url: "https://github.com/jane", label: "GitHub" },
      { kind: "website", url: "https://jane.dev", label: "jane.dev" },
    ],
    template_keys: [],
  });

  it("merges a blog author and a template author with the same id", () => {
    const [jane] = mergeAuthorProfiles(
      [blogAuthor],
      [templateAuthor("jane", "Jane D.")],
    );
    expect(jane).toMatchObject({
      id: "jane",
      name: "Jane Doe",
      role: "Engineer",
      avatar: "/authors/jane.webp",
      bio: "Jane D. builds agents.",
    });
    expect(jane!.links.map((link) => link.url)).toEqual([
      "https://github.com/jane",
      "https://jane.dev",
    ]);
  });

  it("gives a template-only author a profile with initials", () => {
    const profiles = mergeAuthorProfiles(
      [blogAuthor],
      [templateAuthor("acme", "Acme Labs")],
    );
    expect(profiles.map((profile) => profile.id)).toEqual(["acme", "jane"]);
    expect(profiles[0]).toMatchObject({
      name: "Acme Labs",
      initials: "AL",
      avatar: undefined,
    });
    expect(profiles[0]!.links[0]).toMatchObject({ platform: "github" });
    expect(profiles[0]!.links[1]).toMatchObject({ platform: undefined });
  });

  it("covers every template author in the generated data", () => {
    const ids = mergeAuthorProfiles([], authors).map((profile) => profile.id);
    for (const template of templates) {
      expect(ids).toContain(template.author.id);
      expect(templatesByAuthor(template.author.id)).toContain(template);
    }
  });
});
