import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { normalize } from "./copy-openapi.mjs";

const SOURCE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../docs/docs/reference/openapi.json",
);

describe("normalize", () => {
  it("replaces the relative server with the real cloud base URLs", () => {
    const output = normalize({
      openapi: "3.1.0",
      info: { title: "Agenta API", version: "0.1.0" },
      // A relative "/api" would resolve against agenta.ai, which serves no API.
      servers: [{ url: "/api" }],
      paths: { "/apps": {} },
    });

    expect(output.servers.map((server) => server.url)).toEqual([
      "https://us.cloud.agenta.ai/api",
      "https://eu.cloud.agenta.ai/api",
    ]);
  });

  it("drops the admin surface but keeps the product API", () => {
    const output = normalize({
      openapi: "3.1.0",
      info: { title: "Agenta API", version: "0.1.0" },
      paths: { "/apps": {}, "/admin/simple/accounts/": {} },
    });

    expect(Object.keys(output.paths)).toEqual(["/apps"]);
  });

  it("refuses anything that is not an OpenAPI document", () => {
    expect(() => normalize({ hello: "world" })).toThrow(/valid OpenAPI/);
    expect(() => normalize(null)).toThrow(/valid OpenAPI/);
    // `info` is required by the spec: without it the published file would be
    // syntactically fine and semantically useless to a client.
    expect(() => normalize({ openapi: "3.1.0", paths: {} })).toThrow(
      /valid OpenAPI/,
    );
    expect(() =>
      normalize({ openapi: "3.1.0", info: { title: "x" }, paths: {} }),
    ).toThrow(/valid OpenAPI/);
  });
});

describe("the committed source spec", () => {
  it("is publishable", () => {
    const spec = JSON.parse(readFileSync(SOURCE, "utf8"));
    expect(spec.openapi).toMatch(/^3\./);
    expect(Object.keys(spec.paths).length).toBeGreaterThan(100);
    expect(Object.keys(normalize(spec).paths).length).toBeGreaterThan(100);
  });
});
