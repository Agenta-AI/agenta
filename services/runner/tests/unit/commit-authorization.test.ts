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
import { mkdirSync } from "node:fs";
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
  type RelayExecutionAuthorizer,
  type RelayResponse,
} from "../../src/tools/relay.ts";
import {
  buildApprovedContentWiring,
  createCommitAuthorizationState,
} from "../../src/engines/sandbox_agent/approved-content.ts";
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

/** The relay hook `runTurn` installs, over a bare `CommitAuthorizer`. */
function relayAuthorizerFor(
  authorizer: CommitAuthorizer,
): RelayExecutionAuthorizer {
  return async (spec, req) =>
    authorizer.authorizeExecution({
      toolName: spec.name,
      toolCallId: req.toolCallId,
      args: req.args,
    });
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

/** Drive the real relay loop over a forged execute record, with the real authorizer wired in
 *  exactly as `runTurn` wires it. */
async function relayOnce(input: {
  spec: ResolvedToolSpec;
  args: unknown;
  authorizer: RelayExecutionAuthorizer;
  toolCallId?: string;
  runContext?: RunContext;
}): Promise<RelayResponse> {
  const dir = mkdtempSync(join(tmpdir(), "agenta-commit-auth-"));
  try {
    const id = input.toolCallId ?? "call-1";
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
      { authorizer: input.authorizer },
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

describe("the forged relay record, end to end", () => {
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
      authorizer: relayAuthorizerFor(h.authorizer),
    });

    // A refusal is an ERROR result carrying its reason. It reached Codex as a blank SUCCESS
    // before this, and the model responded by inventing an explanation and asking the user to
    // approve again.
    assert.equal(response.ok, false, "a refusal is a tool ERROR, not a success");
    assert.match(
      String((response as { error: string }).error),
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
      authorizer: relayAuthorizerFor(h.authorizer),
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

// ---------------------------------------------------------------------------
// The wiring the turn installs (execution-authorization.md 3.5)
// ---------------------------------------------------------------------------

describe("a denied gate keeps nothing", () => {
  const commitSpec: ResolvedToolSpec = {
    name: "commit_revision",
    kind: "callback",
    callRef: "tools.agenta.commit_revision",
    permission: "ask",
    readOnly: false,
  };

  /** The wiring `runTurn` builds, over a real import root. */
  function wiringOver(files: Record<string, string>) {
    const cwd = mkdtempSync(join(tmpdir(), "agenta-deny-"));
    mkdirSync(join(cwd, ".agenta-imports"), { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(cwd, ".agenta-imports", name), content);
    }
    const state = createCommitAuthorizationState();
    const wiring = buildApprovedContentWiring({
      state,
      isDaytona: false,
      workspaceCwd: cwd,
      sandbox: undefined,
      callback: undefined,
      runContext: undefined,
      permissionPlan: { default: "ask", rules: [] },
      toolSpecs: [commitSpec],
      turnId: TURN,
      sessionId: SESSION,
    });
    return { cwd, state, wiring };
  }

  /** A marker nested inside an added item: no base text to fetch, so no callback is needed. */
  function skillArgs(path: string) {
    return commitArgs([
      {
        operation: "add_item",
        target: ["parameters", "agent", "skills"],
        value: {
          name: "pdf",
          files: [{ path: "x.py", content: { "@ag.file": path } }],
        },
      },
    ]);
  }

  it("discards the denied call while a parked sibling keeps its approval", async () => {
    // The two-gate turn is the case that matters. The store is session-scoped and the turn
    // clears it only when NOTHING parked, so the sibling's park is what keeps the denied call's
    // records alive long past the human's "no".
    const { cwd, state, wiring } = wiringOver({
      "denied.py": "print('rejected')\n",
      "carried.py": "print('still waiting')\n",
    });
    try {
      const deniedArgs = skillArgs(".agenta-imports/denied.py");
      const carriedArgs = skillArgs(".agenta-imports/carried.py");
      await wiring.onResolveApprovedContent({
        toolName: "commit_revision",
        toolCallId: "call-denied",
        args: deniedArgs,
      });
      await wiring.onResolveApprovedContent({
        toolName: "commit_revision",
        toolCallId: "call-carried",
        args: carriedArgs,
      });
      assert.equal(state.frozen.size, 2, "both gates froze their bytes");

      wiring.onDenied("call-denied");

      assert.deepEqual(state.store.recordsFor("call-denied"), []);
      assert.equal(
        state.store.recordsFor("call-carried").length,
        1,
        "the parked sibling is untouched: it was never answered",
      );
      assert.equal(state.frozen.size, 1, "the denied bytes were released");

      const dispatched: string[] = [];
      globalThis.fetch = (async (_url: any, init: any) => {
        dispatched.push(String(init?.body ?? ""));
        return new Response("ok", { status: 200 });
      }) as typeof fetch;

      // A forged execute record carrying the denied call's exact id and arguments. On a non-Pi
      // harness the relay guard passes `ask`, so the authorization record is the only thing
      // between this file and a commit the human rejected.
      const forged = await relayOnce({
        spec: commitSpec,
        args: deniedArgs,
        toolCallId: "call-denied",
        authorizer: wiring.authorizer,
      });
      assert.equal(forged.ok, false, "a refusal is a tool ERROR, not a success");
      assert.match(
        String((forged as { error: string }).error),
        /authorization_missing/,
      );
      assert.deepEqual(dispatched, [], "nothing reached Agenta");

      // And the sibling still commits its approved bytes when the human says yes.
      const approved = await relayOnce({
        spec: commitSpec,
        args: carriedArgs,
        toolCallId: "call-carried",
        authorizer: wiring.authorizer,
      });
      assert.equal(approved.ok, true);
      assert.equal(dispatched.length, 1);
      assert.match(dispatched[0], /still waiting/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("ignores a call id it never minted for", async () => {
    const { cwd, wiring } = wiringOver({ "a.py": "print(1)\n" });
    try {
      wiring.onDenied("never-seen");
      wiring.onDenied(undefined);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// The gate id and the relay id are different values for one call
// ---------------------------------------------------------------------------

describe("an approved import, executed through the shim's own call id", () => {
  const commitSpec: ResolvedToolSpec = {
    name: "commit_revision",
    kind: "callback",
    callRef: "tools.agenta.commit_revision",
    permission: "ask",
    readOnly: false,
  };

  it("executes the approved bytes when the relay reports a different call id", async () => {
    // THE PRODUCTION SHAPE. On a non-Pi harness the ACP gate carries the HARNESS's tool call id
    // (`toolu_...` on Claude), and the in-sandbox MCP shim later relays the same call under a
    // fresh uuid of its own (`tool-mcp-stdio.ts` passes `randomUUID()`), because a `tools/call`
    // carries no harness id for it to reuse. So the id that minted the records and the id that
    // executes are different values for one call, and every approved import failed closed.
    const dir = mkdtempSync(join(tmpdir(), "agenta-two-ids-"));
    mkdirSync(join(dir, ".agenta-imports"), { recursive: true });
    writeFileSync(join(dir, ".agenta-imports", "x.py"), "print('approved')\n");
    const state = createCommitAuthorizationState();
    const wiring = buildApprovedContentWiring({
      state,
      isDaytona: false,
      workspaceCwd: dir,
      sandbox: undefined,
      callback: undefined,
      runContext: undefined,
      permissionPlan: { default: "ask", rules: [] },
      toolSpecs: [commitSpec],
      turnId: TURN,
      sessionId: SESSION,
    });
    const args = commitArgs([
      {
        operation: "add_item",
        target: ["parameters", "agent", "skills"],
        value: {
          name: "pdf",
          files: [{ path: "x.py", content: { "@ag.file": ".agenta-imports/x.py" } }],
        },
      },
    ]);

    try {
      // The gate: the harness's id.
      const manifest = await wiring.onResolveApprovedContent({
        toolName: "commit_revision",
        toolCallId: "toolu_01HARNESS",
        args,
      });
      assert.ok(manifest.ok);
      assert.equal(state.store.recordsFor("toolu_01HARNESS").length, 1);

      const dispatched: string[] = [];
      globalThis.fetch = (async (_url: any, init: any) => {
        dispatched.push(String(init?.body ?? ""));
        return new Response("ok", { status: 200 });
      }) as typeof fetch;

      // The execution: the shim's id.
      const response = await relayOnce({
        spec: commitSpec,
        args,
        toolCallId: "b7f1c0de-0000-4000-8000-000000000000",
        authorizer: wiring.authorizer,
      });

      // The refusal arrives as tool-result TEXT, not as an error, which is why the model reads
      // it and retries the same call forever instead of stopping.
      const text = String((response as { text?: string }).text ?? "");
      assert.doesNotMatch(text, /authorization_missing/, text);
      assert.equal(dispatched.length, 1, "the approved commit reached Agenta");
      assert.match(dispatched[0], /print\('approved'\)/);
      assert.doesNotMatch(dispatched[0], /@ag\.file/);
      assert.equal(state.store.size, 0, "and the approval was consumed exactly once");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});


// ---------------------------------------------------------------------------
// A refusal must never read as success (the Codex blank-success defect)
// ---------------------------------------------------------------------------

describe("the invariant: a logged refusal is never an empty success", () => {
  it("holds for every refusal the relay can produce", async () => {
    // What the model saw on Codex was `output: "" isError: false`. It read that as the commit
    // having worked, said so, then invented reasons when the change was not there. The invariant
    // is the general form: if the runner logged a refusal, the transport must not report a
    // non-error result, and it must not report an empty one.
    const dir = mkdtempSync(join(tmpdir(), "agenta-refusal-"));
    mkdirSync(join(dir, ".agenta-imports"), { recursive: true });
    writeFileSync(join(dir, ".agenta-imports", "x.py"), "print(1)\n");
    const state = createCommitAuthorizationState();
    const logged: string[] = [];
    const wiring = buildApprovedContentWiring({
      state,
      isDaytona: false,
      workspaceCwd: dir,
      sandbox: undefined,
      callback: undefined,
      runContext: undefined,
      permissionPlan: { default: "ask", rules: [] },
      toolSpecs: [
        {
          name: "commit_revision",
          kind: "callback",
          callRef: "tools.agenta.commit_revision",
          permission: "ask",
          readOnly: false,
        },
      ],
      turnId: TURN,
      sessionId: SESSION,
      log: (message) => logged.push(message),
    });

    const args = commitArgs([
      {
        operation: "add_item",
        target: ["parameters", "agent", "skills"],
        value: {
          name: "pdf",
          files: [{ path: "x.py", content: { "@ag.file": ".agenta-imports/x.py" } }],
        },
      },
    ]);

    try {
      // Never gated, so the relay must refuse.
      const response = await relayOnce({
        spec: {
          name: "commit_revision",
          kind: "callback",
          callRef: "tools.agenta.commit_revision",
          permission: "ask",
          readOnly: false,
        },
        args,
        authorizer: wiring.authorizer,
      });

      const refusalLogged = logged.some((line) =>
        line.includes("[commit-auth] refused"),
      );
      assert.ok(refusalLogged, "the runner logged a refusal");

      assert.equal(
        response.ok,
        false,
        "a logged refusal must not be reported as a successful call",
      );
      const reason = String((response as { error?: string }).error ?? "");
      assert.notEqual(reason, "", "and it must not be reported with no reason");
      assert.match(reason, /authorization_missing/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// A marker that cannot resolve: what the runner knows, and what it can pass on
// ---------------------------------------------------------------------------

describe("an unresolvable marker keeps its reason", () => {
  const commitSpec: ResolvedToolSpec = {
    name: "commit_revision",
    kind: "callback",
    callRef: "tools.agenta.commit_revision",
    permission: "ask",
    readOnly: false,
  };

  /**
   * THE LIVE SHAPE, reproduced exactly. Gate cell G1 ran Mahmoud's own phrasing on
   * pi_core+haiku and one trial failed like this: the model copied the whole skill DIRECTORY
   * into the import root, then referenced a path that did not match where the file landed. The
   * fail-closed refusal was correct; what the model was told about it was not.
   */
  function g1Workspace() {
    const cwd = mkdtempSync(join(tmpdir(), "agenta-marker-miss-"));
    mkdirSync(join(cwd, ".agenta-imports", "gstack-autoplan"), {
      recursive: true,
    });
    writeFileSync(
      join(cwd, ".agenta-imports", "gstack-autoplan", "SKILL.md"),
      "# gstack-autoplan\n",
    );
    const state = createCommitAuthorizationState();
    const wiring = buildApprovedContentWiring({
      state,
      isDaytona: false,
      workspaceCwd: cwd,
      sandbox: undefined,
      callback: undefined,
      runContext: undefined,
      permissionPlan: { default: "ask", rules: [] },
      toolSpecs: [commitSpec],
      turnId: TURN,
      sessionId: SESSION,
    });
    return { cwd, state, wiring };
  }

  const skillBodyArgs = (path: string) =>
    commitArgs([
      {
        operation: "add_item",
        target: ["parameters", "agent", "skills"],
        value: {
          name: "gstack-autoplan",
          description: "d",
          body: { "@ag.file": path },
        },
      },
    ]);

  it("names the path, the failure, and what IS under the import root", async () => {
    // The regression this file exists to prevent from coming back: the resolver used to keep
    // `error.message` and drop the rest, so `available` — the ONE field that names the
    // correction — was computed by the reader and discarded one frame later.
    const { cwd, wiring } = g1Workspace();
    try {
      const outcome = await wiring.onResolveApprovedContent({
        toolName: "commit_revision",
        toolCallId: "call-1",
        args: skillBodyArgs(".agenta-imports/SKILL.md"),
      });

      assert.equal(outcome.ok, false);
      if (outcome.ok) return;
      const detail = outcome.detail;
      assert.ok(detail, "the structured detail must survive the catch");
      assert.equal(detail.code, "source_not_found");
      assert.deepEqual(
        detail.available,
        ["gstack-autoplan/"],
        "the directory the model actually copied in is the correction it needed",
      );
      // THE TRAILING SLASH IS LOAD-BEARING, and it is why this asserts the exact string rather
      // than a substring. The failing model referenced a FILE path at a place where a DIRECTORY
      // sat. `gstack-autoplan/` says both what exists and that it is not the file being asked
      // for, which is the whole correction in one token.
      assert.ok(String(detail.available).endsWith("/"));
      assert.equal(typeof detail.next_step, "string");
      assert.match(String(outcome.reason), /does not exist under \.agenta-imports/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("still fails CLOSED: nothing is minted, nothing is frozen, nothing dispatches", async () => {
    // Fail-closed is not traded for a better message. A call whose bytes could not be read must
    // not mint an authorization, must not hold frozen content, and must not be executable from
    // the relay even by a forged execute record carrying its exact id and arguments.
    const { cwd, state, wiring } = g1Workspace();
    const args = skillBodyArgs(".agenta-imports/SKILL.md");
    try {
      const outcome = await wiring.onResolveApprovedContent({
        toolName: "commit_revision",
        toolCallId: "call-1",
        args,
      });
      assert.equal(outcome.ok, false, "the gate is refused");
      assert.deepEqual(state.store.recordsFor("call-1"), []);
      assert.equal(state.frozen.size, 0, "no bytes were frozen");

      const dispatched: string[] = [];
      globalThis.fetch = (async (_url: any, init: any) => {
        dispatched.push(String(init?.body ?? ""));
        return new Response("ok", { status: 200 });
      }) as typeof fetch;

      const forged = await relayOnce({
        spec: commitSpec,
        args,
        toolCallId: "call-1",
        authorizer: wiring.authorizer,
      });
      assert.equal(forged.ok, false);
      assert.match(
        String((forged as { error: string }).error),
        /authorization_missing/,
      );
      assert.deepEqual(dispatched, [], "nothing reached Agenta");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("a marker that DOES resolve is unaffected", async () => {
    // The control. Without it the two tests above would pass just as well against a resolver
    // that failed everything, and would prove nothing about the miss being the cause.
    const { cwd, state, wiring } = g1Workspace();
    try {
      const outcome = await wiring.onResolveApprovedContent({
        toolName: "commit_revision",
        toolCallId: "call-ok",
        args: skillBodyArgs(".agenta-imports/gstack-autoplan/SKILL.md"),
      });
      assert.equal(outcome.ok, true, "the correct path mints a manifest");
      assert.equal(state.store.recordsFor("call-ok").length, 1);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
