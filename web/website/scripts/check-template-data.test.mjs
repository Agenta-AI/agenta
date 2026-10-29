import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { checkTemplateData } from "./check-template-data.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const committed = JSON.parse(
  readFileSync(resolve(root, "src/data/templates.json"), "utf8"),
);

const minimal = () => ({
  schema_version: 1,
  templates: [{ key: "a", author: { id: "jane" } }],
  authors: [{ id: "jane", template_keys: ["a"] }],
});

describe("checkTemplateData", () => {
  it("accepts the committed generated data", () => {
    expect(checkTemplateData(committed)).toEqual([]);
  });

  it("names a template whose author is missing", () => {
    const data = minimal();
    data.templates[0].author.id = "ghost";
    expect(checkTemplateData(data)).toContain(
      'template "a" references author "ghost", which is not in authors',
    );
  });

  it("names an author listing an unknown template", () => {
    const data = minimal();
    data.authors[0].template_keys.push("b");
    expect(checkTemplateData(data)).toContain(
      'author "jane" lists template "b", which is not in templates',
    );
  });

  it("rejects missing arrays and an empty template list", () => {
    expect(checkTemplateData({ schema_version: 1, templates: {} })).toEqual([
      "templates and authors must both be arrays",
    ]);
    expect(
      checkTemplateData({ schema_version: 1, templates: [], authors: [] }),
    ).toEqual(["there are no templates"]);
  });

  it("rejects duplicate keys and unsupported schema versions", () => {
    const data = minimal();
    data.templates.push({ key: "a", author: { id: "jane" } });
    expect(checkTemplateData(data)).toContain('template "a" appears twice');
    expect(checkTemplateData({ schema_version: 2 })[0]).toMatch(
      /schema_version/,
    );
  });
});
