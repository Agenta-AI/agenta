/**
 * Marker resolution at the gate and verify-and-consume at execution (slice S3b).
 *
 * Contracts: `execution-authorization.md` (the record and its lifecycle), `workspace-import.md`
 * section 8 (the approval manifest and the card), `change-set.md` section 6 (the marker).
 *
 * What these tests are really defending: a tool-call id is CORRELATION, not authorization. The
 * relay directory is writable from inside the sandbox, so any process there can write an
 * execute record. On a non-Pi harness the relay guard passes every `ask` verdict, because the
 * harness raises its own dialog and the runner records no grant for it — that pass is a
 * compatibility behavior, and a forged record can ride it. The authorization record is what
 * makes that harmless: it binds the exact tool, the exact arguments, and the exact bytes a human
 * saw, and it is consumed once.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/commit-authorization.test.ts)
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CommitAuthorizer,
  CommitAuthorizationError,
  type ConfigTextFetcher,
} from "../../src/tools/commit-authorization.ts";
import { ExecutionAuthorizationStore } from "../../src/tools/execution-authorization.ts";
import { FrozenValueStore } from "../../src/tools/frozen-value-store.ts";
import {
  ImportError,
  digestOf,
  type ImportedFile,
  type WorkspaceReader,
} from "../../src/tools/workspace-reader.ts";
import { MarkerResolutionError } from "../../src/tools/file-markers.ts";
import {
  localRelayHost,
  startToolRelay,
  type RelayResponse,
} from "../../src/tools/relay.ts";
import type { ResolvedToolSpec, RunContext } from "../../src/protocol.ts";

const ENDPOINT = "https://agenta.example/api/tools/call";
const BASE = "rev-1";
const TURN = "turn-1";
const SESSION = "session-1";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** A reader that serves fixed text and COUNTS its reads, so "a denied call reads nothing" can
 *  be asserted on the reader rather than only on the result. */
class StubReader implements WorkspaceReader {
  reads: string[] = [];

  constructor(private readonly files: Record<string, string>) {}

  async listImportRoot(): Promise<string[]> {
    return Object.keys(this.files);
  }

  async readImportFile(rawPath: string): Promise<ImportedFile> {
    this.reads.push(rawPath);
    const relativePath = rawPath.replace(/^\.agenta-imports\//, "");
    const content = this.files[relativePath];
    if (content === undefined) {
      throw new ImportError("source_not_found", `no file at ${rawPath}`, {
        available: Object.keys(this.files),
      });
    }
    return {
      relativePath,
      content,
      bytes: Buffer.byteLength(content, "utf8"),
      digest: digestOf(content),
      executableBit: false,
    };
  }
}

function commitArgs(
  operations: unknown[],
  baseRevisionId: string | null = BASE,
): unknown {
  return {
    workflow_revision: {
      ...(baseRevisionId ? { base_revision_id: baseRevisionId } : {}),
      delta: { operations },
    },
  };
}

function setFromFile(
  path: string,
  target = ["parameters", "agent", "instructions"],
) {
  return { operation: "set", target, value: { "@ag.file": path } };
}

interface Harness {
  authorizer: CommitAuthorizer;
  reader: StubReader;
  store: ExecutionAuthorizationStore;
  frozen: FrozenValueStore;
  oldTextCalls: Array<{ revisionId: string; target: unknown[] }>;
}

function harness(
  options: {
    files?: Record<string, string>;
    oldText?: string | (() => Promise<string>);
    inline?: "allow" | "gate";
    generation?: () => string;
  } = {},
): Harness {
  const reader = new StubReader(options.files ?? { "notes.md": "new text\n" });
  const frozen = new FrozenValueStore();
  const store = new ExecutionAuthorizationStore(frozen);
  const oldTextCalls: Array<{ revisionId: string; target: unknown[] }> = [];
  const fetchOldText: ConfigTextFetcher = async (input) => {
    oldTextCalls.push(input);
    if (typeof options.oldText === "function") return options.oldText();
    return options.oldText ?? "old text\n";
  };
  return {
    reader,
    frozen,
    store,
    oldTextCalls,
    authorizer: new CommitAuthorizer({
      reader,
      store,
      catalogGeneration: options.generation ?? (() => "gen-1"),
      fetchOldText,
      turnId: TURN,
      sessionId: SESSION,
      decideInline: () => options.inline ?? "gate",
    }),
  };
}

const CALL = { toolName: "commit_revision", toolCallId: "call-1" };

describe("the gate: resolve, freeze, and mint", () => {
  it("mints one record per marker and returns a manifest the card can render", async () => {
    const h = harness({
      files: { "notes.md": "new text\n", "x.py": "print(1)\n" },
    });
    const args = commitArgs([
      setFromFile(".agenta-imports/notes.md"),
      {
        operation: "add_item",
        target: ["parameters", "agent", "skills"],
        value: {
          name: "pdf",
          files: [
            { path: "x.py", content: { "@ag.file": ".agenta-imports/x.py" } },
          ],
        },
      },
    ]);

    const manifest = await h.authorizer.mintForGate({ ...CALL, args });

    assert.ok(manifest, "a marker-carrying call produces a manifest");
    assert.equal(h.store.size, 2, "one record per marker, not per operation");
    assert.equal(manifest.files.length, 2);
    assert.deepEqual(
      manifest.files.map((file) => file.relativePath).sort(),
      ["notes.md", "x.py"],
      "the card lists every file by path",
    );
    for (const file of manifest.files) {
      assert.ok(file.digest, "every file carries its own digest");
      assert.ok(file.bytes > 0);
    }
    assert.equal(manifest.catalogGeneration, "gen-1");
  });

  it("shows a diff of the old text at the operation's OWN base revision", async () => {
    const h = harness({
      files: { "notes.md": "line one\nline two CHANGED\n" },
      oldText: "line one\nline two\n",
    });

    const manifest = await h.authorizer.mintForGate({
      ...CALL,
      args: commitArgs([setFromFile(".agenta-imports/notes.md")]),
    });

    assert.equal(manifest?.diffs.length, 1);
    const diff = manifest!.diffs[0];
    assert.equal(
      diff.baseRevisionId,
      BASE,
      "the old side is fetched at the base the operation names, never the session's revision",
    );
    assert.deepEqual(h.oldTextCalls, [
      { revisionId: BASE, target: ["parameters", "agent", "instructions"] },
    ]);
    assert.match(diff.diff, /-line two/);
    assert.match(diff.diff, /\+line two CHANGED/);
    assert.equal(diff.addedLines, 1);
    assert.equal(diff.removedLines, 1);
    assert.equal(diff.targetField, "instructions");
    assert.equal(diff.oldDigest, digestOf("line one\nline two\n"));
  });

  it("fails closed with no card and no record when the old text cannot be fetched", async () => {
    const h = harness({
      oldText: async () => {
        throw new Error("upstream unavailable");
      },
    });

    await assert.rejects(
      () =>
        h.authorizer.mintForGate({
          ...CALL,
          args: commitArgs([setFromFile(".agenta-imports/notes.md")]),
        }),
      (error: CommitAuthorizationError) => {
        assert.equal(error.code, "source_base_unavailable");
        assert.equal(error.retryable, true);
        return true;
      },
    );
    assert.equal(
      h.store.size,
      0,
      "a fetch failure mints nothing: the human is never asked to approve a replacement without seeing what it replaces",
    );
    assert.equal(h.frozen.size, 0, "and it leaks no frozen bytes");
  });

  it("fails closed when the commit names no base revision at all", async () => {
    const h = harness();
    await assert.rejects(
      () =>
        h.authorizer.mintForGate({
          ...CALL,
          args: commitArgs([setFromFile(".agenta-imports/notes.md")], null),
        }),
      (error: CommitAuthorizationError) =>
        error.code === "source_base_unavailable",
    );
  });

  it("discards every record when one marker of a set fails to resolve", async () => {
    const h = harness({ files: { "notes.md": "ok\n" } });
    const args = commitArgs([
      setFromFile(".agenta-imports/notes.md"),
      {
        operation: "add_item",
        target: ["parameters", "agent", "skills"],
        value: { body: { "@ag.file": ".agenta-imports/missing.md" } },
      },
    ]);

    await assert.rejects(
      () => h.authorizer.mintForGate({ ...CALL, args }),
      (error: MarkerResolutionError) => error.code === "source_not_found",
    );
    assert.equal(
      h.store.size,
      0,
      "a partially resolvable commit has no meaning",
    );
    assert.equal(h.frozen.size, 0);
  });

  it("refuses more markers than one commit may carry, before reading anything", async () => {
    const files: Record<string, string> = {};
    const operations: unknown[] = [];
    for (let index = 0; index < 9; index += 1) {
      files[`f${index}.md`] = "x";
      operations.push({
        operation: "add_item",
        target: ["parameters", "agent", "skills"],
        value: { body: { "@ag.file": `.agenta-imports/f${index}.md` } },
      });
    }
    const h = harness({ files });

    await assert.rejects(
      () => h.authorizer.mintForGate({ ...CALL, args: commitArgs(operations) }),
      (error: CommitAuthorizationError) =>
        error.code === "source_limit_exceeded",
    );
    assert.deepEqual(
      h.reader.reads,
      [],
      "the limit is checked before any read",
    );
  });

  it("does nothing at all for a call carrying no markers", async () => {
    const h = harness();
    const manifest = await h.authorizer.mintForGate({
      ...CALL,
      args: commitArgs([
        { operation: "set", target: ["parameters", "agent"], value: "plain" },
      ]),
    });
    assert.equal(manifest, undefined);
    assert.deepEqual(h.reader.reads, []);
    assert.equal(h.store.size, 0);
  });
});

describe("execution: verify, consume, substitute", () => {
  it("substitutes the frozen bytes and consumes the record exactly once", async () => {
    const h = harness({ files: { "notes.md": "the approved text\n" } });
    const args = commitArgs([setFromFile(".agenta-imports/notes.md")]);
    await h.authorizer.mintForGate({ ...CALL, args });

    const first = await h.authorizer.authorizeExecution({ ...CALL, args });
    assert.ok(first.ok);
    const operations = (first as { ok: true; args: any }).args.workflow_revision
      .delta.operations;
    assert.equal(
      operations[0].value,
      "the approved text\n",
      "a `set` whose whole value is a marker gets the file's text — the founding use case",
    );

    const second = await h.authorizer.authorizeExecution({ ...CALL, args });
    assert.equal(second.ok, false, "a record is single-use");
    assert.match((second as { reason: string }).reason, /authorization_/);
  });

  it("executes the FROZEN bytes even when the file changed after the approval", async () => {
    const files = { "notes.md": "approved\n" };
    const h = harness({ files });
    const args = commitArgs([setFromFile(".agenta-imports/notes.md")]);
    await h.authorizer.mintForGate({ ...CALL, args });

    files["notes.md"] = "swapped after the human approved\n";

    const outcome = await h.authorizer.authorizeExecution({ ...CALL, args });
    assert.ok(outcome.ok);
    assert.equal(
      (outcome as { ok: true; args: any }).args.workflow_revision.delta
        .operations[0].value,
      "approved\n",
      "what the human approved is what commits; the workspace is never reread",
    );
  });

  it("refuses a call whose arguments changed after the approval", async () => {
    const h = harness({ files: { "notes.md": "x\n", "other.md": "y\n" } });
    await h.authorizer.mintForGate({
      ...CALL,
      args: commitArgs([setFromFile(".agenta-imports/notes.md")]),
    });

    // Same tool-call id, different arguments: the same-id substitution case.
    const outcome = await h.authorizer.authorizeExecution({
      ...CALL,
      args: commitArgs([
        setFromFile(".agenta-imports/notes.md", [
          "parameters",
          "agent",
          "other",
        ]),
      ]),
    });
    assert.equal(outcome.ok, false);
    assert.match(
      (outcome as { reason: string }).reason,
      /authorization_mismatch/,
    );
  });

  it("refuses when the tool catalog advanced under a minted record", async () => {
    let generation = "gen-1";
    const h = harness({ generation: () => generation });
    const args = commitArgs([setFromFile(".agenta-imports/notes.md")]);
    await h.authorizer.mintForGate({ ...CALL, args });

    generation = "gen-2";

    const outcome = await h.authorizer.authorizeExecution({ ...CALL, args });
    assert.equal(outcome.ok, false);
    assert.match(
      (outcome as { reason: string }).reason,
      /catalog_generation_stale/,
    );
  });

  it("fails a marker-carrying call closed when no record exists and the policy does not allow", async () => {
    const h = harness({ inline: "gate" });
    const outcome = await h.authorizer.authorizeExecution({
      ...CALL,
      args: commitArgs([setFromFile(".agenta-imports/notes.md")]),
    });
    assert.equal(outcome.ok, false);
    assert.match(
      (outcome as { reason: string }).reason,
      /authorization_missing/,
    );
    assert.deepEqual(
      h.reader.reads,
      [],
      "a forged record for a call the runner never gated must not trigger a workspace read",
    );
  });

  it("resolves inline ONLY on an explicit allow verdict from the permission plan", async () => {
    const h = harness({ inline: "allow", files: { "notes.md": "inline\n" } });
    const args = commitArgs([setFromFile(".agenta-imports/notes.md")]);

    const outcome = await h.authorizer.authorizeExecution({ ...CALL, args });
    assert.ok(
      outcome.ok,
      "an allow verdict is a positive statement by the policy owner",
    );
    assert.equal(
      (outcome as { ok: true; args: any }).args.workflow_revision.delta
        .operations[0].value,
      "inline\n",
    );
    assert.equal(
      h.store.size,
      0,
      "the inline path still mints, verifies, and consumes: one execution path, one set of digests",
    );
  });

  it("passes a call with no markers straight through", async () => {
    const h = harness();
    const args = commitArgs([
      { operation: "set", target: ["parameters", "agent"], value: "plain" },
    ]);
    const outcome = await h.authorizer.authorizeExecution({ ...CALL, args });
    assert.ok(outcome.ok);
    assert.equal((outcome as { ok: true; args: unknown }).args, args);
  });

  it("refuses when an approved marker is missing from the executed call", async () => {
    const h = harness({ files: { "a.md": "a\n", "b.md": "b\n" } });
    const twoMarkers = commitArgs([
      {
        operation: "add_item",
        target: ["parameters", "agent", "skills"],
        value: {
          body: { "@ag.file": ".agenta-imports/a.md" },
          extra: { "@ag.file": ".agenta-imports/b.md" },
        },
      },
    ]);
    await h.authorizer.mintForGate({ ...CALL, args: twoMarkers });
    assert.equal(h.store.size, 2);

    // The attacker drops one marker from an approved multi-marker commit.
    const oneMarker = commitArgs([
      {
        operation: "add_item",
        target: ["parameters", "agent", "skills"],
        value: { body: { "@ag.file": ".agenta-imports/a.md" } },
      },
    ]);
    const outcome = await h.authorizer.authorizeExecution({
      ...CALL,
      args: oneMarker,
    });
    assert.equal(outcome.ok, false);
    assert.equal(
      h.store.size,
      0,
      "and the whole set is discarded, not half-consumed",
    );
  });

  it("produces exactly one execution for two concurrent execute records", async () => {
    const h = harness({ files: { "notes.md": "once\n" } });
    const args = commitArgs([setFromFile(".agenta-imports/notes.md")]);
    await h.authorizer.mintForGate({ ...CALL, args });

    const [first, second] = await Promise.all([
      h.authorizer.authorizeExecution({ ...CALL, args }),
      h.authorizer.authorizeExecution({ ...CALL, args }),
    ]);
    assert.equal(
      [first.ok, second.ok].filter(Boolean).length,
      1,
      "verify-and-consume is one synchronous step, so only one racer can claim the set",
    );
  });
});

describe("park, resume, and cold fallback", () => {
  it("a live resume consumes the parked record and commits the approved bytes", async () => {
    // The park keeps the SAME store (the environment survives), so the resume finds its record.
    const h = harness({ files: { "notes.md": "parked bytes\n" } });
    const args = commitArgs([setFromFile(".agenta-imports/notes.md")]);
    await h.authorizer.mintForGate({ ...CALL, args });

    assert.equal(h.frozen.size, 1, "the frozen bytes are held across the park");

    const resumed = await h.authorizer.authorizeExecution({ ...CALL, args });
    assert.ok(resumed.ok);
    assert.equal(
      (resumed as { ok: true; args: any }).args.workflow_revision.delta
        .operations[0].value,
      "parked bytes\n",
    );
  });

  it("a cold resume starts with an empty store, so it asks again instead of executing", async () => {
    const h = harness({ files: { "notes.md": "x\n" } });
    const args = commitArgs([setFromFile(".agenta-imports/notes.md")]);
    await h.authorizer.mintForGate({ ...CALL, args });

    // Destroying the environment destroys the frozen-value store and the records with it. The
    // cold turn is a NEW authorizer over a new store.
    const cold = harness({ files: { "notes.md": "x\n" } });
    const outcome = await cold.authorizer.authorizeExecution({ ...CALL, args });

    assert.equal(
      outcome.ok,
      false,
      "the approval named specific bytes that no longer exist; re-resolving and executing would run content no human saw",
    );
    assert.match(
      (outcome as { reason: string }).reason,
      /authorization_missing/,
    );
  });
});

describe("the forged relay record, end to end", () => {
  /** Drive the real relay loop over a forged execute record, with the real authorizer wired in
   *  exactly as `runTurn` wires it. */
  async function relayOnce(input: {
    spec: ResolvedToolSpec;
    args: unknown;
    authorizer: CommitAuthorizer;
    runContext?: RunContext;
  }): Promise<RelayResponse> {
    const dir = mkdtempSync(join(tmpdir(), "agenta-commit-auth-"));
    try {
      const id = "call-1";
      const relay = startToolRelay(
        localRelayHost(),
        dir,
        [input.spec],
        { endpoint: ENDPOINT, authorization: "ApiKey secret" },
        input.runContext,
        undefined,
        // No guard: this isolates the authorization check. On a non-Pi harness the guard would
        // PASS this `ask` call anyway, which is precisely why the check cannot live there.
        undefined,
        {
          authorizer: async (spec, req) =>
            input.authorizer.authorizeExecution({
              toolName: spec.name,
              toolCallId: req.toolCallId,
              args: req.args,
            }),
        },
      );
      writeFileSync(
        join(dir, `${id}.req.json`),
        JSON.stringify({
          toolName: input.spec.name,
          toolCallId: id,
          args: input.args,
        }),
      );
      const resPath = join(dir, `${id}.res.json`);
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline && !existsSync(resPath)) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await relay.stop();
      assert.ok(existsSync(resPath), "the relay wrote a response file");
      return JSON.parse(readFileSync(resPath, "utf-8")) as RelayResponse;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const commitSpec: ResolvedToolSpec = {
    name: "commit_revision",
    kind: "callback",
    callRef: "tools.agenta.commit_revision",
    permission: "ask",
    readOnly: false,
  };

  it("refuses a forged record for a call the runner never gated, and reads no file", async () => {
    const h = harness({ inline: "gate", files: { "notes.md": "secret\n" } });
    const calls: string[] = [];
    globalThis.fetch = (async (url: any) => {
      calls.push(String(url));
      return new Response("ok", { status: 200 });
    }) as typeof fetch;

    const response = await relayOnce({
      spec: commitSpec,
      args: commitArgs([setFromFile(".agenta-imports/notes.md")]),
      authorizer: h.authorizer,
    });

    assert.equal(
      response.ok,
      true,
      "a refusal is a tool RESULT, so the model loop continues",
    );
    assert.match(
      String((response as { text: string }).text),
      /authorization_missing/,
    );
    assert.deepEqual(calls, [], "nothing was dispatched to Agenta");
    assert.deepEqual(h.reader.reads, [], "and no workspace file was read");
  });

  it("executes an approved call with the frozen bytes substituted", async () => {
    const h = harness({ files: { "notes.md": "approved body\n" } });
    const args = commitArgs([setFromFile(".agenta-imports/notes.md")]);
    await h.authorizer.mintForGate({
      toolName: "commit_revision",
      toolCallId: "call-1",
      args,
    });

    const bodies: string[] = [];
    globalThis.fetch = (async (_url: any, init: any) => {
      bodies.push(String(init?.body ?? ""));
      return new Response("ok", { status: 200 });
    }) as typeof fetch;

    const response = await relayOnce({
      spec: commitSpec,
      args,
      authorizer: h.authorizer,
    });

    assert.equal(response.ok, true);
    assert.equal(bodies.length, 1, "one commit, one request");
    assert.match(
      bodies[0],
      /approved body/,
      "the dispatched call carries the approved text, not the marker",
    );
    assert.doesNotMatch(bodies[0], /@ag\.file/);
  });
});
