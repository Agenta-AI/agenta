/**
 * The strict serializer, the frozen-value store, and the single-use execution authorization
 * (slice S3b, core only).
 *
 * Contract: docs/design/agent-config-editing/contracts/execution-authorization.md sections
 * 2.3.5 (the serializer's own test obligations), 3.2, 3.3, 3.4, 5, and 6.
 *
 * The two attacks the record exists to stop have their own describes: a forged record, and
 * same-id argument substitution.
 *
 * Run: pnpm exec vitest run tests/unit/execution-authorization.test.ts
 */
import { beforeEach, describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  AuthorizationError,
  ExecutionAuthorizationStore,
  strictDigest,
  type MarkerKey,
} from "../../src/tools/execution-authorization.ts";
import {
  FrozenValueLimitError,
  FrozenValueStore,
} from "../../src/tools/frozen-value-store.ts";
import {
  StrictSerializationError,
  strictCanonicalJson,
} from "../../src/tools/strict-canonical-json.ts";

// ---------------------------------------------------------------------------
// strictCanonicalJson (contract 2.3.3, obligations in 2.3.5)
// ---------------------------------------------------------------------------

describe("strictCanonicalJson", () => {
  it("keeps the three colliding argument sets apart", () => {
    // Contract 2.3.1: the lenient serializer digests all three identically, which is the
    // whole same-id substitution hole. These must differ.
    const a = strictDigest({ value: '{"x":1}' });
    const b = strictDigest({ value: { x: 1 } });
    const c = strictDigest({ value: '{"x":1}}}' });
    assert.notEqual(a, b);
    assert.notEqual(a, c);
    assert.notEqual(b, c);
  });

  it("never changes a JSON-looking string's type", () => {
    assert.notEqual(strictDigest({ a: "[]" }), strictDigest({ a: [] }));
    assert.notEqual(strictDigest({ a: "{}" }), strictDigest({ a: {} }));
    assert.notEqual(strictDigest({ a: "null" }), strictDigest({ a: null }));
  });

  it("ignores object key order", () => {
    assert.equal(
      strictCanonicalJson({ b: 1, a: 2 }),
      strictCanonicalJson({ a: 2, b: 1 }),
    );
  });

  it("preserves array order", () => {
    assert.notEqual(strictDigest([1, 2]), strictDigest([2, 1]));
  });

  it("keeps 1, '1', and true apart", () => {
    const digests = new Set([
      strictDigest(1),
      strictDigest("1"),
      strictDigest(true),
    ]);
    assert.equal(digests.size, 3);
  });

  it("sorts keys by UTF-16 code unit, not by locale", () => {
    // A locale-aware sort would order these differently on some systems, and the digest
    // would then depend on the host.
    assert.equal(strictCanonicalJson({ B: 1, a: 2 }), '{"B":1,"a":2}');
  });

  const rejected: Array<[string, unknown]> = [
    ["undefined", undefined],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["a BigInt", BigInt(1)],
    ["a Date", new Date()],
    ["a Map", new Map()],
    ["a Set", new Set()],
    ["a function", () => undefined],
    ["a symbol", Symbol("x")],
    ["a null-prototype object", Object.create(null)],
  ];

  for (const [label, value] of rejected) {
    it(`rejects ${label}`, () => {
      assert.throws(
        () => strictCanonicalJson({ value }),
        (error: Error) => error instanceof StrictSerializationError,
      );
    });
  }

  it("rejects a cycle", () => {
    const node: Record<string, unknown> = {};
    node.self = node;
    assert.throws(
      () => strictCanonicalJson(node),
      (error: StrictSerializationError) => {
        assert.match(error.message, /cycle/);
        return true;
      },
    );
  });

  it("allows the same object twice when it is not a cycle", () => {
    // A shared reference is ordinary data; only a true cycle is unencodable.
    const shared = { x: 1 };
    assert.equal(
      strictCanonicalJson({ a: shared, b: shared }),
      '{"a":{"x":1},"b":{"x":1}}',
    );
  });

  it("keeps a lone surrogate apart from a valid pair", () => {
    const lone = strictDigest({ s: "\ud800" });
    const pair = strictDigest({ s: "𐀀" });
    assert.notEqual(lone, pair);
    // Well-formed JSON.stringify escapes the lone surrogate rather than emitting it raw.
    assert.equal(strictCanonicalJson("\ud800"), '"\\ud800"');
  });

  it("digests an object by its own properties, not by a toJSON hook", () => {
    // A toJSON hook would let a crafted object choose its own digest input.
    const withHook = { a: 1, toJSON: () => ({ a: 999 }) };
    assert.throws(() => strictCanonicalJson(withHook)); // the hook itself is a function
    const plain = { a: 1, b: "toJSON" };
    assert.equal(strictCanonicalJson(plain), '{"a":1,"b":"toJSON"}');
  });

  it("never reads a property from the prototype chain", () => {
    // eslint-disable-next-line no-extend-native
    (Object.prototype as unknown as Record<string, unknown>).injected = "evil";
    try {
      assert.equal(strictCanonicalJson({ a: 1 }), '{"a":1}');
    } finally {
      delete (Object.prototype as unknown as Record<string, unknown>).injected;
    }
  });

  it("normalizes -0 to 0, as JSON does", () => {
    assert.equal(strictCanonicalJson(-0), "0");
    assert.equal(strictDigest(-0), strictDigest(0));
  });

  it("serializes nested structures deterministically", () => {
    const value = { z: [1, { b: 2, a: 3 }], a: "x" };
    assert.equal(strictCanonicalJson(value), '{"a":"x","z":[1,{"a":3,"b":2}]}');
  });

  it("names the path of the offending value", () => {
    assert.throws(
      () => strictCanonicalJson({ outer: { inner: [1, Number.NaN] } }),
      (error: StrictSerializationError) => {
        assert.equal(error.pointer, "/outer/inner/1");
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// The frozen-value store (contract 5, 6.2)
// ---------------------------------------------------------------------------

describe("FrozenValueStore", () => {
  it("returns the exact value it was given", () => {
    const store = new FrozenValueStore();
    const value = { body: "# Skill\n" };
    const handle = store.put("turn-1", value, 8);
    assert.deepEqual(store.get(handle), value);
  });

  it("scopes a handle to its turn", () => {
    // A handle from another turn must not resolve, or a stale approval could execute in a
    // later turn.
    const store = new FrozenValueStore();
    const handle = store.put("turn-1", "x", 1);
    assert.equal(store.get({ id: handle.id, turnId: "turn-2" }), undefined);
  });

  it("releases one handle", () => {
    const store = new FrozenValueStore();
    const handle = store.put("turn-1", "x", 1);
    store.release(handle);
    assert.equal(store.has(handle), false);
  });

  it("releases everything a turn froze", () => {
    const store = new FrozenValueStore();
    store.put("turn-1", "a", 1);
    store.put("turn-1", "b", 1);
    store.put("turn-2", "c", 1);
    assert.equal(store.releaseTurn("turn-1"), 2);
    assert.equal(store.size, 1);
  });

  it("caps a turn's total bytes", () => {
    const store = new FrozenValueStore({ maxTurnBytes: 10 });
    store.put("turn-1", "a", 8);
    assert.throws(
      () => store.put("turn-1", "b", 8),
      (error: Error) => error instanceof FrozenValueLimitError,
    );
  });

  it("caps a turn's entry count", () => {
    const store = new FrozenValueStore({ maxTurnEntries: 1 });
    store.put("turn-1", "a", 1);
    assert.throws(() => store.put("turn-1", "b", 1), FrozenValueLimitError);
  });

  it("counts each turn's usage separately", () => {
    const store = new FrozenValueStore({ maxTurnEntries: 1 });
    store.put("turn-1", "a", 1);
    store.put("turn-2", "b", 1);
    assert.equal(store.size, 2);
  });
});

// ---------------------------------------------------------------------------
// The authorization lifecycle (contract 3)
// ---------------------------------------------------------------------------

const MARKER_A: MarkerKey = { operationIndex: 0, valuePointer: "/body" };
const MARKER_B: MarkerKey = {
  operationIndex: 0,
  valuePointer: "/files/0/content",
};

const ARGS = {
  workflow_revision: {
    delta: {
      operations: [
        { operation: "add_item", value: { body: { "@ag.file": "a.md" } } },
      ],
    },
  },
};

describe("ExecutionAuthorizationStore", () => {
  let frozen: FrozenValueStore;
  let store: ExecutionAuthorizationStore;
  let clock: number;

  beforeEach(() => {
    clock = 1_000;
    frozen = new FrozenValueStore();
    store = new ExecutionAuthorizationStore(frozen, {
      ttlMs: 1_000,
      now: () => clock,
    });
  });

  function mint(
    marker: MarkerKey = MARKER_A,
    overrides: Record<string, unknown> = {},
  ) {
    return store.mint({
      toolName: "commit_revision",
      toolCallId: "call-1",
      originalArgs: ARGS,
      resolvedValue: "# Skill\n",
      resolvedBytes: 8,
      manifest: { entries: [] },
      catalogGeneration: "gen-1",
      sourcePath: "a.md",
      marker,
      turnId: "turn-1",
      sessionId: "sess-1",
      ...overrides,
    });
  }

  function verifyArgs(overrides: Record<string, unknown> = {}) {
    return {
      toolName: "commit_revision",
      toolCallId: "call-1",
      executedArgs: ARGS,
      requiredMarkers: [MARKER_A],
      catalogGeneration: "gen-1",
      ...overrides,
    };
  }

  // The gate and the execution do not always see one call id, so the set is matched on what
  // actually binds it. Every one of these asserts that the match is no weaker than the id was.
  describe("findSetByCall", () => {
    const find = (overrides: Record<string, unknown> = {}) =>
      store.findSetByCall({
        toolName: "commit_revision",
        argsDigest: strictDigest(ARGS),
        requiredMarkers: [MARKER_A],
        ...overrides,
      });

    it("finds the set the gate minted, under the id the gate used", () => {
      mint();
      assert.equal(find(), "call-1");
    });

    it("refuses a different tool under the same arguments", () => {
      mint();
      assert.equal(find({ toolName: "delete_variant" }), undefined);
    });

    it("refuses arguments that differ by one byte", () => {
      mint();
      const tampered = strictDigest({
        ...ARGS,
        workflow_revision: {
          delta: {
            operations: [
              { operation: "add_item", value: { body: { "@ag.file": "b.md" } } },
            ],
          },
        },
      });
      assert.equal(find({ argsDigest: tampered }), undefined);
    });

    it("refuses a set that was already consumed, so single use survives", () => {
      mint();
      store.consumeAll("call-1", [MARKER_A]);
      assert.equal(find(), undefined);
    });

    it("refuses a set that expired", () => {
      mint();
      clock += 2_000;
      assert.equal(find(), undefined);
    });

    it("refuses a set that does not cover every marker the call carries", () => {
      // An approval for a one-marker commit must not stand in for a two-marker one.
      mint(MARKER_A);
      assert.equal(find({ requiredMarkers: [MARKER_A, MARKER_B] }), undefined);
    });

    it("refuses a set that covers more markers than the call carries", () => {
      mint(MARKER_A);
      mint(MARKER_B);
      assert.equal(find({ requiredMarkers: [MARKER_A] }), undefined);
    });

    it("hands out one set at a time when two identical commits are approved", () => {
      mint();
      mint(MARKER_A, { toolCallId: "call-2" });
      const first = find();
      assert.ok(first);
      store.consumeAll(first, [MARKER_A]);
      const second = find();
      assert.ok(second);
      assert.notEqual(second, first, "the consumed set is not offered again");
      store.consumeAll(second, [MARKER_A]);
      assert.equal(find(), undefined);
    });
  });

  describe("mint", () => {
    it("binds the call and freezes the content", () => {
      const record = mint();
      assert.equal(record.toolName, "commit_revision");
      assert.equal(record.argsDigest, strictDigest(ARGS));
      assert.equal(record.contentDigest, strictDigest("# Skill\n"));
      assert.equal(record.consumed, false);
      assert.equal(frozen.get(record.frozenValueRef), "# Skill\n");
    });

    it("never holds the bytes on the record itself", () => {
      // The record travels into logs and interaction rows; the bytes must not.
      const record = mint();
      assert.equal(JSON.stringify(record).includes("# Skill"), false);
    });

    it("expires after the ttl", () => {
      const record = mint();
      assert.equal(record.expiresAtMs, record.createdAtMs + 1_000);
    });

    it("refuses to mint when the arguments cannot be digested exactly", () => {
      // Fail closed: no weaker key, no record. Stricter than the lenient approval matcher,
      // which may silently no-op.
      assert.throws(
        () => mint(MARKER_A, { originalArgs: { when: new Date() } }),
        (error: AuthorizationError) => {
          assert.equal(error.reason, "unserializable_arguments");
          return true;
        },
      );
      assert.equal(store.size, 0);
    });
  });

  describe("verifyAll", () => {
    it("passes a matching call", () => {
      mint();
      const verified = store.verifyAll(verifyArgs());
      assert.equal(verified.length, 1);
    });

    it("fails closed when no record exists", () => {
      assert.throws(
        () => store.verifyAll(verifyArgs()),
        (error: AuthorizationError) => {
          assert.equal(error.reason, "missing_record");
          return true;
        },
      );
    });

    it("rejects a different tool reusing the call id", () => {
      mint();
      assert.throws(
        () => store.verifyAll(verifyArgs({ toolName: "test_run" })),
        (error: AuthorizationError) => {
          assert.equal(error.reason, "tool_mismatch");
          return true;
        },
      );
    });

    it("rejects an expired record", () => {
      mint();
      clock += 2_000;
      assert.throws(
        () => store.verifyAll(verifyArgs()),
        (error: AuthorizationError) => {
          assert.equal(error.reason, "expired");
          return true;
        },
      );
    });

    it("rejects a record minted under an older catalog", () => {
      mint();
      assert.throws(
        () => store.verifyAll(verifyArgs({ catalogGeneration: "gen-2" })),
        (error: AuthorizationError) => {
          assert.equal(error.reason, "generation_mismatch");
          return true;
        },
      );
    });

    it("rejects when the frozen content was released", () => {
      // Never re-read the workspace to recover: there would be nothing left to prove the
      // execution matches what a human saw.
      const record = mint();
      frozen.release(record.frozenValueRef);
      assert.throws(
        () => store.verifyAll(verifyArgs()),
        (error: AuthorizationError) => {
          assert.equal(error.reason, "frozen_value_missing");
          return true;
        },
      );
    });

    it("does not consume anything", () => {
      mint();
      store.verifyAll(verifyArgs());
      assert.equal(store.size, 1);
      assert.equal(store.get("call-1", MARKER_A)?.consumed, false);
    });
  });

  describe("same-id argument substitution", () => {
    it("rejects executed arguments that differ from the approved ones", () => {
      // THE attack the digest exists to stop: same tool, same call id, different payload.
      mint();
      const tampered = structuredClone(ARGS);
      tampered.workflow_revision.delta.operations[0].value = {
        body: { "@ag.file": "other.md" },
      };
      assert.throws(
        () => store.verifyAll(verifyArgs({ executedArgs: tampered })),
        (error: AuthorizationError) => {
          assert.equal(error.reason, "args_mismatch");
          return true;
        },
      );
    });

    it("rejects the JSON-string variant the lenient serializer would accept", () => {
      // `{"x":1}` as a string vs as an object digest identically under `canonicalJson`.
      // Under the strict serializer they differ, so the substitution is caught.
      const objectArgs = { value: { x: 1 } };
      const stringArgs = { value: '{"x":1}' };
      mint(MARKER_A, { originalArgs: objectArgs });
      assert.throws(
        () => store.verifyAll(verifyArgs({ executedArgs: stringArgs })),
        (error: AuthorizationError) => {
          assert.equal(error.reason, "args_mismatch");
          return true;
        },
      );
    });
  });

  describe("forged records", () => {
    it("a record for another call id does not authorize this one", () => {
      mint(MARKER_A, { toolCallId: "call-other" });
      assert.throws(
        () => store.verifyAll(verifyArgs()),
        (error: AuthorizationError) => {
          assert.equal(error.reason, "missing_record");
          return true;
        },
      );
    });

    it("a record for another marker does not authorize this one", () => {
      mint(MARKER_B);
      assert.throws(
        () => store.verifyAll(verifyArgs({ requiredMarkers: [MARKER_A] })),
        (error: AuthorizationError) => {
          assert.equal(error.reason, "missing_record");
          return true;
        },
      );
    });

    it("content swapped after minting is rejected", () => {
      // The frozen store is the only source of the executed bytes, so a swap has to happen
      // there; the content digest catches it.
      const record = mint();
      frozen.release(record.frozenValueRef);
      const swapped = frozen.put("turn-1", "EVIL\n", 5);
      (record as { frozenValueRef: typeof swapped }).frozenValueRef = swapped;
      assert.throws(
        () => store.verifyAll(verifyArgs()),
        (error: AuthorizationError) => {
          assert.equal(error.reason, "content_mismatch");
          return true;
        },
      );
    });
  });

  describe("multi-source sets (contract 3.4)", () => {
    it("consumes nothing when one member fails verification", () => {
      // Contract 3.4.2: the COMPLETE set is verified before any of it is consumed. The
      // member that did pass must be untouched, or a failed call would burn half a set.
      mint(MARKER_A);
      assert.throws(() =>
        store.verifyAll(verifyArgs({ requiredMarkers: [MARKER_A, MARKER_B] })),
      );
      assert.equal(store.get("call-1", MARKER_A)?.consumed, false);
      assert.equal(store.size, 1);
    });

    it("fails closed on a missing member", () => {
      mint(MARKER_A);
      assert.throws(
        () =>
          store.verifyAll(
            verifyArgs({ requiredMarkers: [MARKER_A, MARKER_B] }),
          ),
        (error: AuthorizationError) => {
          assert.equal(error.reason, "missing_record");
          assert.equal(error.valuePointer, MARKER_B.valuePointer);
          return true;
        },
      );
    });

    it("fails closed on an extra member", () => {
      // An approved marker missing from the executed call means the executed call is not
      // the approved call: an attacker dropped an operation to change what commits.
      mint(MARKER_A);
      mint(MARKER_B);
      assert.throws(
        () => store.verifyAll(verifyArgs({ requiredMarkers: [MARKER_A] })),
        (error: AuthorizationError) => {
          assert.equal(error.reason, "extra_record");
          return true;
        },
      );
    });

    it("consumes the whole set in one pass", () => {
      mint(MARKER_A);
      mint(MARKER_B);
      const claimed = store.consumeAll("call-1", [MARKER_A, MARKER_B]);
      assert.equal(claimed.length, 2);
      assert.equal(store.size, 0);
    });

    it("hands back each member's frozen value", () => {
      mint(MARKER_A, { resolvedValue: "one" });
      mint(MARKER_B, { resolvedValue: "two" });
      const claimed = store.consumeAll("call-1", [MARKER_A, MARKER_B]);
      assert.deepEqual(
        claimed.map((entry) => entry.value),
        ["one", "two"],
      );
    });

    it("consumes without awaiting, so no execute can interleave", async () => {
      // The property is structural: `consumeAll` is synchronous, so the event loop cannot
      // run a second execute between two consumes. A racing caller finds nothing left.
      mint(MARKER_A);
      mint(MARKER_B);
      const results = await Promise.allSettled([
        Promise.resolve().then(() =>
          store.consumeAll("call-1", [MARKER_A, MARKER_B]),
        ),
        Promise.resolve().then(() =>
          store.consumeAll("call-1", [MARKER_A, MARKER_B]),
        ),
      ]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      assert.equal(fulfilled.length, 1, "exactly one consumer wins");
    });

    it("discards the whole set when consume finds a member gone", () => {
      mint(MARKER_A);
      mint(MARKER_B);
      store.consumeAll("call-1", [MARKER_A]);
      assert.throws(
        () => store.consumeAll("call-1", [MARKER_A, MARKER_B]),
        (error: AuthorizationError) => {
          assert.equal(error.reason, "missing_record");
          return true;
        },
      );
      // Nothing survives for a retry: the human re-approves the whole commit.
      assert.equal(store.recordsFor("call-1").length, 0);
    });
  });

  describe("single use", () => {
    it("a second execution finds nothing", () => {
      mint();
      store.consumeAll("call-1", [MARKER_A]);
      assert.throws(
        () => store.verifyAll(verifyArgs()),
        (error: AuthorizationError) => {
          assert.equal(error.reason, "missing_record");
          return true;
        },
      );
    });

    it("consuming releases nothing the caller still needs", () => {
      const record = mint();
      const claimed = store.consumeAll("call-1", [MARKER_A]);
      assert.equal(claimed[0].value, "# Skill\n");
      assert.equal(claimed[0].record.authorizationId, record.authorizationId);
    });
  });

  describe("cleanup", () => {
    it("discards every record for a call and frees its content", () => {
      mint(MARKER_A);
      mint(MARKER_B);
      assert.equal(store.discardAll("call-1"), 2);
      assert.equal(store.size, 0);
      assert.equal(frozen.usageFor("turn-1").entries, 0);
    });

    it("sweeps expired records", () => {
      mint();
      clock += 2_000;
      assert.equal(store.sweepExpired(), 1);
      assert.equal(frozen.usageFor("turn-1").entries, 0);
    });

    it("leaves a live record alone when sweeping", () => {
      mint();
      assert.equal(store.sweepExpired(), 0);
      assert.equal(store.size, 1);
    });
  });
});
