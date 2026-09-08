/**
 * Unit tests for the login ordering of contract amendment A4: generation first, expiry second.
 *
 * The bug this rule exists to stop: a user signs in again, the new login happens to carry a
 * SHORTER life than a token an old session refreshed a minute ago, and an expiry-only comparison
 * then keeps the dead lineage and rejects the live one. The sidecar is what makes the two
 * distinguishable, so its own read and write ordering is tested here too.
 *
 * Run: pnpm exec vitest run tests/unit/subscription-login-generation.test.ts
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  decideSubscriptionWrite,
  materializeDaytonaSubscriptionLogin,
  materializeLocalSubscriptionLogin,
  parseSubscriptionMeta,
  sandboxFileText,
  subscriptionLoginFrom,
  subscriptionMetaText,
  type SubscriptionSandboxFs,
} from "../../src/engines/sandbox_agent/subscription-login.ts";
import type { SubscriptionLogin } from "../../src/protocol.ts";

const GEN1: SubscriptionLogin = {
  type: "oauth",
  access: "g1-access",
  refresh: "g1-refresh",
  expires: 5_000,
  accountId: "acct_1",
};
const GEN2_SHORTER: SubscriptionLogin = {
  type: "oauth",
  access: "g2-access",
  refresh: "g2-refresh",
  expires: 3_000,
  accountId: "acct_1",
};

const authText = (login: SubscriptionLogin): string =>
  JSON.stringify({ "openai-codex": login });

const homes: string[] = [];
function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "agenta-subscription-gen-"));
  homes.push(home);
  return home;
}
afterEach(() => {
  while (homes.length) rmSync(homes.pop()!, { recursive: true, force: true });
});

describe("parseSubscriptionMeta", () => {
  it("reads the two integers", () => {
    assert.deepEqual(parseSubscriptionMeta('{"generation":2,"version":9}'), {
      generation: 2,
      version: 9,
    });
  });

  it("treats a missing, unreadable, or generation-less sidecar as absent", () => {
    assert.equal(parseSubscriptionMeta(undefined), undefined);
    assert.equal(parseSubscriptionMeta(""), undefined);
    assert.equal(parseSubscriptionMeta("{not json"), undefined);
    assert.equal(parseSubscriptionMeta('{"version":3}'), undefined);
    assert.equal(parseSubscriptionMeta('{"generation":"2"}'), undefined);
  });

  it("defaults a missing version to 0 rather than rejecting the lineage", () => {
    assert.deepEqual(parseSubscriptionMeta('{"generation":4}'), {
      generation: 4,
      version: 0,
    });
  });
});

describe("decideSubscriptionWrite", () => {
  it("writes when there is no local login", () => {
    const decision = decideSubscriptionWrite({
      currentAuth: undefined,
      currentMeta: undefined,
      login: GEN1,
      version: 1,
      generation: 1,
    });
    assert.equal(decision.write, true);
    assert.equal(decision.reason, "no-local");
    assert.deepEqual(JSON.parse(decision.meta as string), {
      generation: 1,
      version: 1,
    });
  });

  it("a newer generation overwrites a local login with a LONGER life", () => {
    const decision = decideSubscriptionWrite({
      currentAuth: authText(GEN1),
      currentMeta: subscriptionMetaText({ generation: 1, version: 4 }),
      login: GEN2_SHORTER,
      version: 5,
      generation: 2,
    });
    assert.equal(decision.write, true);
    assert.equal(decision.reason, "newer-generation");
    assert.deepEqual(
      JSON.parse(decision.auth as string)["openai-codex"],
      GEN2_SHORTER,
    );
  });

  it("an older generation never overwrites, whatever its expiry says", () => {
    const decision = decideSubscriptionWrite({
      currentAuth: authText(GEN2_SHORTER),
      currentMeta: subscriptionMetaText({ generation: 2, version: 5 }),
      login: { ...GEN1, expires: 9_999_999 },
      version: 4,
      generation: 1,
    });
    assert.equal(decision.write, false);
    assert.equal(decision.reason, "older-generation");
  });

  it("inside one generation the later expiry wins", () => {
    const same = { currentMeta: subscriptionMetaText({ generation: 1, version: 4 }) };
    assert.equal(
      decideSubscriptionWrite({
        ...same,
        currentAuth: authText(GEN1),
        login: { ...GEN1, expires: GEN1.expires + 1 },
        version: 5,
        generation: 1,
      }).reason,
      "later-expiry",
    );
    assert.equal(
      decideSubscriptionWrite({
        ...same,
        currentAuth: authText(GEN1),
        login: { ...GEN1, expires: GEN1.expires - 1 },
        version: 5,
        generation: 1,
      }).reason,
      "not-newer",
    );
  });

  it("an equal expiry with a different refresh token still wins", () => {
    const decision = decideSubscriptionWrite({
      currentAuth: authText(GEN1),
      currentMeta: subscriptionMetaText({ generation: 1, version: 4 }),
      login: { ...GEN1, refresh: "rotated" },
      version: 5,
      generation: 1,
    });
    assert.equal(decision.write, true);
    assert.equal(decision.reason, "same-expiry-new-refresh");
  });

  it("an identical login is not rewritten", () => {
    assert.equal(
      decideSubscriptionWrite({
        currentAuth: authText(GEN1),
        currentMeta: subscriptionMetaText({ generation: 1, version: 4 }),
        login: GEN1,
        version: 4,
        generation: 1,
      }).write,
      false,
    );
  });

  it("falls back to the expiry rule when the file has no sidecar", () => {
    // The pre-A4 file this runner can still meet. Without a lineage to compare, expiry decides.
    assert.equal(
      decideSubscriptionWrite({
        currentAuth: authText(GEN1),
        currentMeta: undefined,
        login: GEN2_SHORTER,
        version: 5,
        generation: 2,
      }).reason,
      "not-newer",
    );
  });

  it("refuses a delivered login with no usable expires", () => {
    assert.deepEqual(
      decideSubscriptionWrite({
        currentAuth: undefined,
        currentMeta: undefined,
        login: { ...GEN1, expires: undefined as never },
        version: 1,
        generation: 1,
      }),
      { write: false, reason: "invalid-delivered" },
    );
  });
});

describe("materializeLocalSubscriptionLogin with a sidecar", () => {
  it("writes the sidecar next to the login, never inside it", async () => {
    const home = tempHome();
    await materializeLocalSubscriptionLogin(
      home,
      { login: GEN1, version: 4, generation: 1 },
      () => {},
    );

    const auth = JSON.parse(readFileSync(join(home, "auth.json"), "utf-8"));
    assert.deepEqual(auth["openai-codex"], GEN1);
    assert.deepEqual(JSON.parse(readFileSync(join(home, "meta.json"), "utf-8")), {
      generation: 1,
      version: 4,
    });
    // The sidecar holds no credential.
    const metaText = readFileSync(join(home, "meta.json"), "utf-8");
    for (const secret of [GEN1.access, GEN1.refresh, "acct_1"]) {
      assert.ok(!metaText.includes(secret), `sidecar leaked ${secret}`);
    }
  });

  it("a new sign-in replaces a longer-lived local login of the old lineage", async () => {
    const home = tempHome();
    writeFileSync(join(home, "auth.json"), authText(GEN1), { mode: 0o600 });
    writeFileSync(
      join(home, "meta.json"),
      subscriptionMetaText({ generation: 1, version: 4 }),
    );

    const decision = await materializeLocalSubscriptionLogin(
      home,
      { login: GEN2_SHORTER, version: 5, generation: 2 },
      () => {},
    );

    assert.equal(decision.write, true);
    assert.equal(decision.reason, "newer-generation");
    assert.deepEqual(
      JSON.parse(readFileSync(join(home, "auth.json"), "utf-8"))["openai-codex"],
      GEN2_SHORTER,
    );
  });

  it("a run of the old lineage does not undo a sign-in that already landed", async () => {
    const home = tempHome();
    writeFileSync(join(home, "auth.json"), authText(GEN2_SHORTER), { mode: 0o600 });
    writeFileSync(
      join(home, "meta.json"),
      subscriptionMetaText({ generation: 2, version: 5 }),
    );

    const decision = await materializeLocalSubscriptionLogin(
      home,
      { login: { ...GEN1, expires: 9_999_999 }, version: 4, generation: 1 },
      () => {},
    );

    assert.equal(decision.write, false);
    assert.equal(decision.reason, "older-generation");
    assert.deepEqual(
      JSON.parse(readFileSync(join(home, "auth.json"), "utf-8"))["openai-codex"],
      GEN2_SHORTER,
    );
  });
});

/**
 * The sandbox file API answers with BYTES. This module's own type said `Promise<string>`, which
 * the compiler could not catch and which cost a live defect: every Daytona read-back threw
 * `raw?.trim is not a function`, so a token Pi refreshed inside a sandbox never reached the API,
 * and a warm sandbox that already held a login crashed its own materialize. These pin the decode.
 */
describe("sandboxFileText", () => {
  const text = '{"openai-codex":{"expires":1}}';

  it("decodes every shape the sandbox file API returns", () => {
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
});

describe("the parsers survive a boundary slip", () => {
  it("treat a non-string as a miss, never a crash", () => {
    // A crash here loses a refreshed credential; a miss only skips one publish.
    const bytes = Buffer.from('{"openai-codex":{"expires":1}}') as unknown as string;
    assert.doesNotThrow(() => subscriptionLoginFrom(bytes));
    assert.equal(subscriptionLoginFrom(bytes), undefined);
    assert.doesNotThrow(() => parseSubscriptionMeta(bytes));
    assert.equal(parseSubscriptionMeta(bytes), undefined);
  });
});

describe("materializeDaytonaSubscriptionLogin with a sidecar", () => {
  function fakeSandbox(files: Record<string, string>): {
    sandbox: SubscriptionSandboxFs;
    files: Record<string, string>;
  } {
    const sandbox: SubscriptionSandboxFs = {
      mkdirFs: async () => undefined,
      writeFsFile: async ({ path }, content) => {
        files[path] = content;
      },
      // BYTES, exactly as the Daytona SDK answers. A fake that returns a string would have let
      // the live defect through every one of these tests.
      readFsFile: async ({ path }) => {
        const found = files[path];
        if (found === undefined) throw new Error("ENOENT");
        return Buffer.from(found, "utf-8");
      },
    };
    return { sandbox, files };
  }

  it("writes both files into the sandbox", async () => {
    const { sandbox, files } = fakeSandbox({});
    const decision = await materializeDaytonaSubscriptionLogin(
      sandbox,
      "/home/sandbox/agenta/subscriptions/conn-1",
      { login: GEN1, version: 4, generation: 1 },
      () => {},
    );

    assert.equal(decision.write, true);
    assert.deepEqual(
      JSON.parse(files["/home/sandbox/agenta/subscriptions/conn-1/auth.json"])[
        "openai-codex"
      ],
      GEN1,
    );
    assert.deepEqual(
      JSON.parse(files["/home/sandbox/agenta/subscriptions/conn-1/meta.json"]),
      { generation: 1, version: 4 },
    );
  });

  it("a warm sandbox on a newer lineage keeps its file", async () => {
    const home = "/home/sandbox/agenta/subscriptions/conn-1";
    const { sandbox, files } = fakeSandbox({
      [`${home}/auth.json`]: authText(GEN2_SHORTER),
      [`${home}/meta.json`]: subscriptionMetaText({ generation: 2, version: 5 }),
    });

    const decision = await materializeDaytonaSubscriptionLogin(
      sandbox,
      home,
      { login: { ...GEN1, expires: 9_999_999 }, version: 4, generation: 1 },
      () => {},
    );

    assert.equal(decision.write, false);
    assert.equal(decision.reason, "older-generation");
    assert.deepEqual(
      JSON.parse(files[`${home}/auth.json`])["openai-codex"],
      GEN2_SHORTER,
    );
  });
});
