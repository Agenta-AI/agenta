import { describe, expect, it } from "vitest";

import { NAV_TEMPLATE_PICKS, SHOWCASE_KEYS } from "./landingTemplates";
import {
  authors,
  templateByKey,
  templates,
  templatesByAuthor,
  useItForFreeUrl,
} from "./templates";

describe("website template data", () => {
  it("carries the fields the pages need for every template", () => {
    expect(templates.length).toBeGreaterThan(0);
    for (const template of templates) {
      expect(template.key).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(template.name).toBeTruthy();
      expect(template.summary).toBeTruthy();
      expect(template.description).toBeTruthy();
      expect(template.category).toBeTruthy();
      expect(template.version).toBe(template.latest);
      expect(template.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(template.author.id).toBeTruthy();
    }
  });

  it("derives author membership from template references", () => {
    for (const author of authors) {
      expect(
        templatesByAuthor(author.id).map((template) => template.key),
      ).toEqual(author.template_keys);
    }
  });
});

describe("Use it for free", () => {
  it("links every landing and nav template to a key the catalog loads", () => {
    const keys = [...SHOWCASE_KEYS, ...NAV_TEMPLATE_PICKS.flatMap((g) => g.keys)];
    for (const key of keys) {
      expect(templateByKey(key), key).toBeDefined();
    }
  });

  it("puts each nav pick under its own catalog category", () => {
    for (const group of NAV_TEMPLATE_PICKS) {
      for (const key of group.keys) {
        expect(templateByKey(key)?.category, key).toBe(group.category);
      }
    }
  });

  it("carries only the stable key to the app", () => {
    expect(useItForFreeUrl("pr-reviewer")).toBe(
      "https://cloud.agenta.ai/?template=pr-reviewer",
    );
    expect(useItForFreeUrl("a b", "https://eu.cloud.agenta.ai/")).toBe(
      "https://eu.cloud.agenta.ai/?template=a+b",
    );
  });
});
