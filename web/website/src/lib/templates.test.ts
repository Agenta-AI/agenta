import { describe, expect, it } from "vitest";

import { TEMPLATES as FEATURED } from "../components/TemplateExplorer";
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
  it("links every featured landing template to a key the catalog loads", () => {
    for (const featured of FEATURED) {
      expect(templateByKey(featured.key), featured.key).toBeDefined();
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
