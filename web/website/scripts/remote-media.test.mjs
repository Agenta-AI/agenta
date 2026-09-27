import { describe, expect, it } from "vitest";
import { remoteMediaUrls } from "./remote-media.mjs";

describe("remote article media detection", () => {
  it("detects quoted, unquoted, and MDX expression attributes", () => {
    const source = `
      <img src="https://example.test/quoted.png">
      <video src=https://example.test/unquoted.mov></video>
      <img src={"https://example.test/expression.png"}>
    `;

    expect(remoteMediaUrls(source)).toEqual([
      "https://example.test/quoted.png",
      "https://example.test/unquoted.mov",
      "https://example.test/expression.png",
    ]);
  });

  it("checks every srcset candidate", () => {
    expect(
      remoteMediaUrls(
        '<source srcset="/media/local.webp 1x, https://example.test/remote.webp 2x">',
      ),
    ).toEqual(["https://example.test/remote.webp"]);
  });

  it("allows same-origin media paths and links", () => {
    expect(
      remoteMediaUrls(`
        <img src="/media/blog/example/image.webp">
        <a href="https://example.test">source</a>
      `),
    ).toEqual([]);
  });
});
