import { describe, expect, it } from "vitest";
import {
  errorJson,
  mdPath,
  notFoundMarkdown,
  parseAccept,
  acceptedRepresentations,
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

describe("acceptedRepresentations", () => {
  it("honors q-values in both directions", () => {
    expect(
      acceptedRepresentations("text/markdown;q=0.9, text/html;q=0.8")[0],
    ).toBe("markdown");
    expect(
      acceptedRepresentations("text/markdown;q=0.8, text/html;q=0.9")[0],
    ).toBe("html");
  });

  it("treats a wildcard or an absent header as accepting everything", () => {
    expect(acceptedRepresentations("*/*")).toEqual([
      "html",
      "markdown",
      "json",
    ]);
    expect(acceptedRepresentations(null)).toEqual(["html", "markdown", "json"]);
  });

  it("drops what the client rejected with q=0", () => {
    expect(acceptedRepresentations("text/markdown;q=0, text/html")).toEqual([
      "html",
    ]);
  });

  it("accepts nothing when every type is rejected", () => {
    // `Accept: text/html;q=0` is an explicit refusal, not a weak preference.
    expect(acceptedRepresentations("text/html;q=0")).toEqual([]);
  });

  it("serves HTML to XHTML-era clients and unfurlers", () => {
    expect(acceptedRepresentations("application/xhtml+xml")).toEqual(["html"]);
    expect(acceptedRepresentations("application/xml")).toEqual(["html"]);
    expect(acceptedRepresentations("text/*")).toEqual(["html", "markdown"]);
  });

  it("matches a real browser Accept header to HTML first", () => {
    expect(
      acceptedRepresentations(
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      )[0],
    ).toBe("html");
  });

  it("keeps a second-choice representation we can actually serve", () => {
    // JSON first, markdown second: the twin is the honest answer, not HTML.
    expect(
      acceptedRepresentations("application/json, text/markdown;q=0.8"),
    ).toEqual(["json", "markdown"]);
  });

  it("breaks a quality tie on where the client wrote the range", () => {
    // text/* comes first and covers markdown, so markdown leads even though
    // the later text/html range is the more specific one.
    expect(acceptedRepresentations("text/*, text/html")).toEqual([
      "markdown",
      "html",
    ]);
    expect(acceptedRepresentations("text/markdown, text/html")).toEqual([
      "markdown",
      "html",
    ]);
  });

  it("lets a specific q=0 override a wildcard that accepted it", () => {
    // The exact range is more specific than text/*, so HTML is rejected even
    // though the wildcard would have taken it. RFC 9110 12.5.1.
    expect(acceptedRepresentations("text/*;q=1, text/html;q=0")).toEqual([
      "markdown",
    ]);
  });

  it("returns nothing when we serve none of the accepted types", () => {
    expect(acceptedRepresentations("image/webp")).toEqual([]);
  });
});

describe("mdPath", () => {
  it("maps the root to /index.md", () => {
    expect(mdPath("/")).toBe("/index.md");
  });

  it("strips a trailing slash first", () => {
    // The live sitemap advertises the slash form, and a Cloudflare Transform
    // Rule may re-add it for /authors/<slug>/.
    expect(mdPath("/authors/mahmoud-mabrouk/")).toBe(
      "/authors/mahmoud-mabrouk.md",
    );
    expect(mdPath("/blog")).toBe("/blog.md");
  });

  it("never negotiates a path that already names a file", () => {
    expect(mdPath("/openapi.json")).toBeNull();
    expect(mdPath("/llms.txt")).toBeNull();
    expect(mdPath("/blog/post/hero.webp")).toBeNull();
    // The twins themselves are plain assets, not negotiable routes.
    expect(mdPath("/pricing.md")).toBeNull();
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
      errorJson({
        status: 404,
        code: "not_found",
        message: "No resource exists at this path.",
        path: "/nope",
        hints: ["Fetch /sitemap-index.xml."],
      }),
    );
    expect(parsed.error.code).toBe("not_found");
    expect(parsed.error.status).toBe(404);
    expect(parsed.error.path).toBe("/nope");
    expect(parsed.error.hints).toHaveLength(1);
    expect(parsed.error.sitemap).toBe("https://agenta.ai/sitemap-index.xml");
  });
});
