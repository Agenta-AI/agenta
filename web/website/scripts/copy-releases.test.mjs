import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildFeed } from "./copy-releases.mjs";

const RELEASES_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../packages/agenta-navigation/src/releases",
);
const read = (name) =>
  JSON.parse(readFileSync(resolve(RELEASES_DIR, name), "utf8"));

describe("buildFeed", () => {
  it("publishes the bundled releases and the notices unchanged", () => {
    const releases = read("changelog.json");
    const notices = read("notices.json");

    expect(buildFeed(releases, notices)).toEqual({ releases, notices });
  });

  it("refuses sources that are not lists", () => {
    expect(() => buildFeed({}, [])).toThrow(/changelog/);
    expect(() => buildFeed([], null)).toThrow(/notices/);
  });
});
