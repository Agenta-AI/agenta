import { describe, expect, it } from "vitest";
import { markdownResponse, mdxToMarkdown, page } from "./markdown";

describe("page", () => {
  it("emits the H1, the canonical link, and the agent footer", () => {
    const output = page({
      title: "Pricing",
      description: "What Agenta costs.",
      path: "/pricing",
      body: "## Plans\n\n- Hobby",
    });

    expect(output.startsWith("# Pricing")).toBe(true);
    expect(output).toContain("<https://agenta.ai/pricing>");
    expect(output).toContain("## Plans");
    expect(output).toContain("https://agenta.ai/sitemap-index.xml");
    expect(output).toContain("Accept: text/markdown");
  });

  it("keeps the root canonical as a single slash", () => {
    expect(page({ title: "A", description: "b", path: "/", body: "c" })).toContain(
      "<https://agenta.ai/>",
    );
  });
});

describe("markdownResponse", () => {
  it("labels the media type", () => {
    // Only astro dev reads this; a static build keeps the body, not the
    // headers. The deployed twin gets its headers from public/_headers.
    expect(markdownResponse("# hi").headers.get("content-type")).toBe(
      "text/markdown; charset=utf-8",
    );
  });
});

describe("mdxToMarkdown", () => {
  it("drops imports and self-closing components", () => {
    const output = mdxToMarkdown(
      'import InlineCTA from "../../components/InlineCta.astro";\n\n## Heading\n\n<InlineCTA />\n\nText.',
    );
    expect(output).not.toContain("import");
    expect(output).not.toContain("InlineCTA");
    expect(output).toContain("## Heading");
    expect(output).toContain("Text.");
  });

  it("turns BlogImage into a markdown image, attribute order aside", () => {
    expect(
      mdxToMarkdown('<BlogImage src="/blog/x/img-1.webp" alt="A diagram" />'),
    ).toBe("![A diagram](/blog/x/img-1.webp)");
    expect(
      mdxToMarkdown('<BlogImage alt="A diagram" src="/blog/x/img-1.webp" />'),
    ).toBe("![A diagram](/blog/x/img-1.webp)");
  });

  it("keeps the text a paired component wraps", () => {
    expect(mdxToMarkdown("<Callout>Important thing</Callout>")).toBe(
      "Important thing",
    );
  });

  it("leaves fenced code untouched, JSX-looking or not", () => {
    const source = "Before\n\n```tsx\nconst x = <Foo bar />;\n```\n\nAfter";
    const output = mdxToMarkdown(source);
    expect(output).toContain("const x = <Foo bar />;");
    expect(output).toContain("```tsx");
    expect(output).toContain("After");
  });

  it("keeps a component name written as inline code", () => {
    // A post explaining <InlineCTA /> in prose must not lose the example.
    expect(mdxToMarkdown("Use `<InlineCTA />` to add a call to action.")).toBe(
      "Use `<InlineCTA />` to add a call to action.",
    );
  });

  it("passes ordinary markdown through unchanged", () => {
    const source = "## Heading\n\n- one\n- two\n\n[link](https://agenta.ai)";
    expect(mdxToMarkdown(source)).toBe(source);
  });
});
