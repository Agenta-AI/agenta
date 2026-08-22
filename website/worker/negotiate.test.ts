import { describe, expect, it } from "vitest";
import {
  errorJson,
  mdCandidates,
  notFoundMarkdown,
  parseAccept,
  pickRepresentation,
} from "./negotiate";

describe("parseAccept", () => {
  it("orders by q, then by specificity", () => {
    const entries = parseAccept(
      "*/*;q=0.8, text/html;q=0.9, text/markdown;q=0.9, text/*;q=0.9",
    );
    expect(entries.map((entry) => entry.type)).toEqual([
      "text/html",
      "text/markdown",
      "text/*",
      "*/*",
    ]);
  });

  it("defaults a missing or malformed q to 1", () => {
    expect(parseAccept("text/html")[0].q).toBe(1);
    expect(parseAccept("text/html;q=banana")[0].q).toBe(1);
  });

  it("returns nothing for an absent header", () => {
    expect(parseAccept(null)).toEqual([]);
    expect(parseAccept("")).toEqual([]);
  });
});

describe("pickRepresentation", () => {
  it("honors q-values in both directions", () => {
    expect(pickRepresentation("text/markdown;q=0.9, text/html;q=0.8")).toBe(
      "markdown",
    );
    expect(pickRepresentation("text/markdown;q=0.8, text/html;q=0.9")).toBe(
      "html",
    );
  });

  it("treats a wildcard or an absent header as no preference", () => {
    expect(pickRepresentation("*/*")).toBe("any");
    expect(pickRepresentation(null)).toBe("any");
  });

  it("ignores types the client explicitly rejected with q=0", () => {
    expect(pickRepresentation("text/markdown;q=0, text/html")).toBe("html");
  });

  it("serves HTML to XHTML-era clients and unfurlers", () => {
    expect(pickRepresentation("application/xhtml+xml")).toBe("html");
    expect(pickRepresentation("application/xml")).toBe("html");
    expect(pickRepresentation("text/*")).toBe("html");
  });

  it("matches a real browser Accept header to HTML", () => {
    expect(
      pickRepresentation(
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      ),
    ).toBe("html");
  });

  it("reports `none` only when nothing we serve was accepted", () => {
    expect(pickRepresentation("image/webp")).toBe("none");
    expect(pickRepresentation("application/json")).toBe("json");
  });
});

describe("mdCandidates", () => {
  it("maps the root to /index.md", () => {
    expect(mdCandidates("/")).toEqual(["/index.md"]);
  });

  it("strips a trailing slash before building candidates", () => {
    // The live sitemap advertises the slash form, and a Cloudflare Transform
    // Rule may re-add it for /authors/<slug>/.
    expect(mdCandidates("/authors/mahmoud-mabrouk/")).toEqual([
      "/authors/mahmoud-mabrouk.md",
      "/authors/mahmoud-mabrouk/index.md",
    ]);
  });

  it("offers both the flat and the directory twin", () => {
    expect(mdCandidates("/blog")).toEqual(["/blog.md", "/blog/index.md"]);
  });

  it("never negotiates a path that already names a file", () => {
    expect(mdCandidates("/openapi.json")).toBeNull();
    expect(mdCandidates("/llms.txt")).toBeNull();
    expect(mdCandidates("/blog/post/hero.webp")).toBeNull();
  });
});

describe("bodies", () => {
  it("points a lost agent at the machine-readable map", () => {
    const body = notFoundMarkdown("/nope");
    expect(body).toContain("# 404");
    expect(body).toContain("/sitemap-index.xml");
    expect(body).toContain("/llms.txt");
    expect(body).toContain("/openapi.json");
  });

  it("emits a structured error with a code and hints", () => {
    const parsed = JSON.parse(
      errorJson(404, "not_found", "No resource exists at this path.", "/nope", [
        "Fetch /sitemap-index.xml.",
      ]),
    );
    expect(parsed.error.code).toBe("not_found");
    expect(parsed.error.status).toBe(404);
    expect(parsed.error.path).toBe("/nope");
    expect(parsed.error.hints).toHaveLength(1);
    expect(parsed.error.sitemap).toBe("https://agenta.ai/sitemap-index.xml");
  });
});
