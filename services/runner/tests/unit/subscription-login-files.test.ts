/**
 * Unit tests for where a hosted subscription login lands and who may overwrite it.
 *
 * Two rules carry the design. Generation first, expiry second: a user who signs in again can get a
 * SHORTER-lived token than one an old session refreshed a minute ago, and an expiry-only comparison
 * would then keep the dead lineage. And no write happens outside Pi's own lock.
 *
 * Run: pnpm exec vitest run tests/unit/subscription-login-files.test.ts
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  decideSubscriptionWrite,
  materializeSubscriptionLoginForRun,
  mutateSubscriptionLogin,
  parseSubscriptionMeta,
  readSubscriptionLoginForRun,
  sandboxFileText,
  subscriptionLoginFrom,
  type SubscriptionSandboxFs,
} from "../../src/engines/sandbox_agent/subscription-login/files.ts";
import type { SubscriptionLogin } from "../../src/protocol.ts";

const GEN1: SubscriptionLogin = {
  type: "oauth",
  access: "g1-access",
  refresh: "g1-refresh",
  expires: 5_000,
  accountId: "acct_1",
};
const GEN1_LATER: SubscriptionLogin = { ...GEN1, refresh: "g1-next", expires: 9_000 };
const GEN2_SHORTER: SubscriptionLogin = {
  type: "oauth",
  access: "g2-access",
  refresh: "g2-refresh",
  expires: 3_000,
  accountId: "acct_1",
};

const authText = (login: SubscriptionLogin): string =>
  JSON.stringify({ "openai-codex": login });
const metaText = (generation: number, version: number): string =>
  JSON.stringify({ generation, version });

const homes: string[] = [];
function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "agenta-subscription-files-"));
  homes.push(home);
  return home;
}
afterEach(() => {
  while (homes.length) rmSync(homes.pop()!, { recursive: true, force: true });
});

function fakeSandbox(files: Record<string, string>): SubscriptionSandboxFs {
  return {
    mkdirFs: async () => undefined,
    writeFsFile: async ({ path }, content) => {
      files[path] = content;
    },
    // BYTES, exactly as the Daytona SDK answers. A fake that returned a string would have let the
    // live decode defect through every one of these tests.
    readFsFile: async ({ path }) => {
      const found = files[path];
      if (found === undefined) throw new Error("ENOENT");
      return Buffer.from(found, "utf-8");
    },
  };
}

describe("parseSubscriptionMeta", () => {
  it("reads the two integers", () => {
    assert.deepEqual(parseSubscriptionMeta('{"generation":2,"version":9}'), {
      generation: 2,
      version: 9,
    });
  });

  it("treats a missing, unreadable, or generation-less sidecar as absent", () => {
    for (const raw of [undefined, "", "not json", "[]", '{"version":3}']) {
      assert.equal(parseSubscriptionMeta(raw), undefined, String(raw));
    }
  });

  it("defaults a missing version to 0 rather than rejecting the lineage", () => {
    assert.deepEqual(parseSubscriptionMeta('{"generation":4}'), {
      generation: 4,
      version: 0,
    });
  });
});

describe("decideSubscriptionWrite", () => {
  const decide = (input: {
    local?: SubscriptionLogin;
    meta?: { generation: number; version: number };
    delivered: SubscriptionLogin;
    generation: number;
  }) =>
    decideSubscriptionWrite({
      local: input.local,
      meta: input.meta,
      delivered: input.delivered,
      generation: input.generation,
    });

  it("writes when there is no local login", () => {
    assert.deepEqual(decide({ delivered: GEN1, generation: 1 }), {
      write: true,
      reason: "no-local",
    });
  });

  it("a newer generation overwrites a local login with a LONGER life", () => {
    const decision = decide({
      local: { ...GEN1, expires: 99_000 },
      meta: { generation: 1, version: 4 },
      delivered: GEN2_SHORTER,
      generation: 2,
    });
    assert.deepEqual(decision, { write: true, reason: "newer-generation" });
  });

  it("an older generation never overwrites, whatever its expiry says", () => {
    const decision = decide({
      local: GEN2_SHORTER,
      meta: { generation: 2, version: 5 },
      delivered: { ...GEN1, expires: 99_000 },
      generation: 1,
    });
    assert.deepEqual(decision, { write: false, reason: "older-generation" });
  });

  it("inside one generation the later expiry wins", () => {
    assert.equal(
      decide({
        local: GEN1,
        meta: { generation: 1, version: 4 },
        delivered: GEN1_LATER,
        generation: 1,
      }).reason,
      "later-expiry",
    );
    assert.equal(
      decide({
        local: GEN1_LATER,
        meta: { generation: 1, version: 5 },
        delivered: GEN1,
        generation: 1,
      }).write,
      false,
    );
  });

  it("an equal expiry with a different refresh token still wins", () => {
    // The provider rotates the refresh token on every exchange, so both are valid and the
    // delivered one is the copy the API can still hand to the next run.
    const decision = decide({
      local: GEN1,
      meta: { generation: 1, version: 4 },
      delivered: { ...GEN1, refresh: "rotated" },
      generation: 1,
    });
    assert.deepEqual(decision, { write: true, reason: "same-expiry-new-refresh" });
  });

  it("an identical login is not rewritten", () => {
    assert.deepEqual(
      decide({
        local: GEN1,
        meta: { generation: 1, version: 4 },
        delivered: GEN1,
        generation: 1,
      }),
      { write: false, reason: "not-newer" },
    );
  });

  it("falls back to the expiry rule when the file has no sidecar", () => {
    assert.equal(
      decide({ local: GEN1, delivered: GEN1_LATER, generation: 7 }).reason,
      "later-expiry",
    );
  });

  it("refuses a delivered login with no usable expires", () => {
    assert.deepEqual(
      decide({
        local: GEN1,
        delivered: { ...GEN1, expires: undefined as never },
        generation: 1,
      }),
      { write: false, reason: "invalid-delivered" },
    );
  });
});

describe("materialize on local disk", () => {
  it("writes the login and its sidecar under the lock, at mode 0600", async () => {
    const home = tempHome();
    const locked: string[] = [];
    const decision = await materializeSubscriptionLoginForRun({
      home,
      isDaytona: false,
      subscription: { id: "conn-1", login: GEN1, version: 4, generation: 1 },
      log: () => {},
      fileDeps: {
        lock: (async (path: string) => {
          locked.push(path);
          return async () => {};
        }) as never,
      },
    });

    assert.equal(decision.write, true);
    assert.deepEqual(
      locked,
      [join(home, "auth.json")],
      "the lock is taken on the auth file itself, the path Pi locks",
    );
    assert.deepEqual(
      subscriptionLoginFrom(readFileSync(join(home, "auth.json"), "utf-8")),
      GEN1,
    );
    assert.deepEqual(
      JSON.parse(readFileSync(join(home, "meta.json"), "utf-8")),
      { generation: 1, version: 4 },
      "the lineage lives NEXT to the login, never inside it",
    );
    assert.equal(statSync(join(home, "auth.json")).mode & 0o777, 0o600);
  });

  it("a run of the old lineage does not undo a sign-in that already landed", async () => {
    const home = tempHome();
    writeFileSync(join(home, "auth.json"), authText(GEN2_SHORTER), { mode: 0o600 });
    writeFileSync(join(home, "meta.json"), metaText(2, 5), { mode: 0o600 });

    const decision = await materializeSubscriptionLoginForRun({
      home,
      isDaytona: false,
      subscription: {
        id: "conn-1",
        login: { ...GEN1, expires: 99_000 },
        version: 4,
        generation: 1,
      },
      log: () => {},
    });

    assert.deepEqual(decision, { write: false, reason: "older-generation" });
    assert.deepEqual(
      await readSubscriptionLoginForRun({ home, isDaytona: false }),
      GEN2_SHORTER,
    );
  });

  it("preserves another provider's entry in the same file", async () => {
    const home = tempHome();
    writeFileSync(
      join(home, "auth.json"),
      JSON.stringify({ other: { keep: true } }),
      { mode: 0o600 },
    );
    await materializeSubscriptionLoginForRun({
      home,
      isDaytona: false,
      subscription: { id: "conn-1", login: GEN1, version: 1, generation: 1 },
      log: () => {},
    });
    const map = JSON.parse(readFileSync(join(home, "auth.json"), "utf-8"));
    assert.deepEqual(map.other, { keep: true });
    assert.deepEqual(map["openai-codex"], GEN1);
  });

  it("takes the real lock, so a concurrent materialize serializes", async () => {
    const home = tempHome();
    // Two writers, the newer one second. Whatever the order, the newer login must survive.
    await Promise.all([
      materializeSubscriptionLoginForRun({
        home,
        isDaytona: false,
        subscription: { id: "conn-1", login: GEN1_LATER, version: 5, generation: 1 },
        log: () => {},
      }),
      materializeSubscriptionLoginForRun({
        home,
        isDaytona: false,
        subscription: { id: "conn-1", login: GEN1, version: 4, generation: 1 },
        log: () => {},
      }),
    ]);
    assert.deepEqual(
      await readSubscriptionLoginForRun({ home, isDaytona: false }),
      GEN1_LATER,
    );
  });

  it("holds the lock across an awaiting mutation, so a read cannot slip in", async () => {
    // The refresh path exchanges a token with the provider inside the mutation. A second reader
    // must not observe the file until the write that follows that exchange has landed.
    const home = tempHome();
    writeFileSync(join(home, "auth.json"), authText(GEN1), { mode: 0o600 });
    const order: string[] = [];
    let releaseProvider: (() => void) | undefined;
    const provider = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });

    const writer = mutateSubscriptionLogin<string>({
      home,
      isDaytona: false,
      mutate: async () => {
        order.push("mutate-start");
        await provider;
        order.push("mutate-end");
        return { result: "written", login: GEN1_LATER };
      },
    });
    // Let the writer take the lock before the reader asks for it.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const reader = readSubscriptionLoginForRun({ home, isDaytona: false }).then(
      (login) => {
        order.push("read");
        return login;
      },
    );
    releaseProvider?.();

    const outcome = await writer;
    assert.equal(outcome.wrote, true);
    assert.deepEqual(await reader, GEN1_LATER);
    assert.deepEqual(order, ["mutate-start", "mutate-end", "read"]);
  });
});

describe("materialize on a Daytona sandbox", () => {
  const home = "/home/sandbox/agenta/subscriptions/conn-1";

  it("writes both files into the sandbox", async () => {
    const files: Record<string, string> = {};
    const decision = await materializeSubscriptionLoginForRun({
      home,
      isDaytona: true,
      sandbox: fakeSandbox(files),
      subscription: { id: "conn-1", login: GEN1, version: 4, generation: 1 },
      log: () => {},
    });

    assert.equal(decision.write, true);
    assert.deepEqual(JSON.parse(files[`${home}/auth.json`])["openai-codex"], GEN1);
    assert.deepEqual(JSON.parse(files[`${home}/meta.json`]), {
      generation: 1,
      version: 4,
    });
  });

  it("a warm sandbox on a newer lineage keeps its file", async () => {
    const files: Record<string, string> = {
      [`${home}/auth.json`]: authText(GEN2_SHORTER),
      [`${home}/meta.json`]: metaText(2, 5),
    };
    const decision = await materializeSubscriptionLoginForRun({
      home,
      isDaytona: true,
      sandbox: fakeSandbox(files),
      subscription: {
        id: "conn-1",
        login: { ...GEN1, expires: 99_000 },
        version: 4,
        generation: 1,
      },
      log: () => {},
    });

    assert.deepEqual(decision, { write: false, reason: "older-generation" });
    assert.deepEqual(
      JSON.parse(files[`${home}/auth.json`])["openai-codex"],
      GEN2_SHORTER,
    );
  });

  it("refuses a write when the file moved while the mutation ran", async () => {
    // There is no cross-sandbox lock, so the guard is a re-read. Another writer installing a login
    // during a provider exchange must not be overwritten.
    const files: Record<string, string> = { [`${home}/auth.json`]: authText(GEN1) };
    const sandbox = fakeSandbox(files);
    const outcome = await mutateSubscriptionLogin<string>({
      home,
      isDaytona: true,
      sandbox,
      mutate: async () => {
        files[`${home}/auth.json`] = authText(GEN2_SHORTER);
        return { result: "attempted", login: GEN1_LATER };
      },
    });

    assert.equal(outcome.wrote, false);
    assert.deepEqual(
      JSON.parse(files[`${home}/auth.json`])["openai-codex"],
      GEN2_SHORTER,
    );
  });
});

describe("reading whatever the sandbox file API returns", () => {
  const text = '{"openai-codex":{"expires":1}}';

  it("decodes every shape it answers with", () => {
    assert.equal(sandboxFileText(text), text);
    assert.equal(sandboxFileText(Buffer.from(text, "utf-8")), text);
    assert.equal(sandboxFileText(new TextEncoder().encode(text)), text);
    assert.equal(
      sandboxFileText(new TextEncoder().encode(text).buffer as ArrayBuffer),
      text,
    );
  });

  it("refuses to coerce anything else, rather than parsing plausible garbage", () => {
    for (const value of [undefined, null, 42, {}, [], { type: "Buffer" }]) {
      assert.equal(sandboxFileText(value), undefined, String(value));
    }
  });

  it("the parsers treat a non-string as a miss, never a crash", () => {
    // A crash here loses a refreshed credential; a miss only skips one publish.
    const bytes = Buffer.from(text) as unknown as string;
    assert.doesNotThrow(() => subscriptionLoginFrom(bytes));
    assert.equal(subscriptionLoginFrom(bytes), undefined);
    assert.doesNotThrow(() => parseSubscriptionMeta(bytes));
    assert.equal(parseSubscriptionMeta(bytes), undefined);
  });

  it("replaces a half-written file rather than reading it as a login", async () => {
    const home = tempHome();
    writeFileSync(join(home, "auth.json"), '{"openai-codex":{"acc', { mode: 0o600 });
    const decision = await materializeSubscriptionLoginForRun({
      home,
      isDaytona: false,
      subscription: { id: "conn-1", login: GEN1, version: 1, generation: 1 },
      log: () => {},
    });
    assert.deepEqual(decision, { write: true, reason: "no-local" });
  });
});
