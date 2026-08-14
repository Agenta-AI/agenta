import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, it } from "vitest";

import {
  parseMockConfig,
  readMockConfig,
} from "../../src/engines/sandbox_agent/mock-config.ts";

describe("parseMockConfig", () => {
  it("accepts a known behaviour with kwargs", () => {
    const config = parseMockConfig(
      JSON.stringify({ behavior: "reply", kwargs: { text: "hi" } }),
    );
    assert.deepEqual(config, { behavior: "reply", kwargs: { text: "hi" } });
  });

  it("defaults kwargs to an empty object when absent", () => {
    const config = parseMockConfig(JSON.stringify({ behavior: "error" }));
    assert.deepEqual(config, { behavior: "error", kwargs: {} });
  });

  it("rejects unparseable JSON", () => {
    assert.throws(() => parseMockConfig("{not json"), /not valid JSON/);
  });

  it("rejects a non-object top level", () => {
    assert.throws(() => parseMockConfig("[1,2,3]"), /must be a JSON object/);
  });

  it("rejects a missing behavior field", () => {
    assert.throws(() => parseMockConfig("{}"), /missing a string 'behavior'/);
  });

  it("rejects an unknown behaviour name, never falling back to a default", () => {
    assert.throws(
      () => parseMockConfig(JSON.stringify({ behavior: "does-not-exist" })),
      /unknown behaviour 'does-not-exist'/,
    );
  });

  it("rejects a non-object kwargs field", () => {
    assert.throws(
      () => parseMockConfig(JSON.stringify({ behavior: "reply", kwargs: "nope" })),
      /'kwargs' must be an object/,
    );
  });
});

describe("readMockConfig", () => {
  let cwd: string;

  afterEach(() => {
    if (cwd) rmSync(cwd, { recursive: true, force: true });
  });

  it("reads and parses the config from the local session cwd", async () => {
    cwd = mkdtempSync(join(tmpdir(), "agenta-mock-config-"));
    mkdirSync(join(cwd, ".agenta"), { recursive: true });
    writeFileSync(
      join(cwd, ".agenta", "mock.json"),
      JSON.stringify({ behavior: "reply", kwargs: { text: "hi" } }),
      "utf-8",
    );

    const config = await readMockConfig({ readFsFile: async () => "" }, cwd, false);
    assert.deepEqual(config, { behavior: "reply", kwargs: { text: "hi" } });
  });

  it("fails loud when the local config file is missing, never falling back", async () => {
    cwd = mkdtempSync(join(tmpdir(), "agenta-mock-config-"));
    await assert.rejects(
      () => readMockConfig({ readFsFile: async () => "" }, cwd, false),
      /mock harness config not found/,
    );
  });

  it("reads via the sandbox FS API on Daytona", async () => {
    const config = await readMockConfig(
      {
        readFsFile: async ({ path }) => {
          assert.match(path, /\/home\/sandbox\/.agenta\/mock\.json$/);
          return JSON.stringify({ behavior: "error", kwargs: { message: "boom" } });
        },
      },
      "/home/sandbox",
      true,
    );
    assert.deepEqual(config, { behavior: "error", kwargs: { message: "boom" } });
  });

  it("fails loud when the sandbox FS read rejects", async () => {
    await assert.rejects(
      () =>
        readMockConfig(
          { readFsFile: async () => Promise.reject(new Error("no such file")) },
          "/home/sandbox",
          true,
        ),
      /mock harness config not found/,
    );
  });
});
