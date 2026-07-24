/**
 * Unit tests for the sandbox-id read helper that backs the remote reconnect ladder. The write
 * side (the live sandbox id landing on the next turn's row) is covered by
 * `session-continuity-durable.test.ts`'s `appendSessionTurn` tests. Exercised through injected
 * fetch/deps -- no real HTTP.
 *
 * Run: pnpm exec vitest run tests/unit/sandbox-reconnect.test.ts
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { readStoredSandboxPointer } from "../../src/engines/sandbox_agent/sandbox-reconnect.ts";

const SILENT = () => {};

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

function errResponse(status: number): Response {
  return { ok: false, status, json: async () => ({}) } as unknown as Response;
}

describe("readStoredSandboxPointer", () => {
  it("returns the latest turn's sandbox_id", async () => {
    const pointer = await readStoredSandboxPointer("sess-1", {
      apiBase: "http://api:8000",
      authorization: "ApiKey abc",
      fetchImpl: (async () =>
        okResponse({
          turns: [{ sandbox_id: "sbx-42", turn_index: 3 }],
        })) as unknown as typeof fetch,
      log: SILENT,
    });
    assert.deepEqual(pointer, { sandboxId: "sbx-42" });
  });

  it("queries unscoped by harness (the pointer is session-wide, not per-harness)", async () => {
    let body: Record<string, unknown> | undefined;
    await readStoredSandboxPointer("sess-1", {
      apiBase: "http://api:8000",
      authorization: "ApiKey abc",
      fetchImpl: (async (_url: string, init?: RequestInit) => {
        body = JSON.parse(init!.body as string);
        return okResponse({ turns: [] });
      }) as unknown as typeof fetch,
      log: SILENT,
    });
    assert.deepEqual(body!["query"], { session_id: "sess-1" });
    assert.deepEqual(body!["windowing"], { limit: 1, order: "descending" });
  });

  it("returns undefined when no turn has a sandbox_id", async () => {
    const id = await readStoredSandboxPointer("sess-1", {
      apiBase: "http://api:8000",
      authorization: "ApiKey abc",
      fetchImpl: (async () =>
        okResponse({ turns: [{ turn_index: 0 }] })) as unknown as typeof fetch,
      log: SILENT,
    });
    assert.equal(id, undefined);
  });

  it("returns undefined when there are no turns yet", async () => {
    const id = await readStoredSandboxPointer("sess-1", {
      apiBase: "http://api:8000",
      authorization: "ApiKey abc",
      fetchImpl: (async () =>
        okResponse({ turns: [] })) as unknown as typeof fetch,
      log: SILENT,
    });
    assert.equal(id, undefined);
  });

  it("returns undefined on a non-2xx (degrades to a fresh create)", async () => {
    const id = await readStoredSandboxPointer("sess-1", {
      apiBase: "http://api:8000",
      authorization: "ApiKey abc",
      fetchImpl: (async () => errResponse(503)) as unknown as typeof fetch,
      log: SILENT,
    });
    assert.equal(id, undefined);
  });

  it("returns undefined when fetch throws, no throw out", async () => {
    const id = await readStoredSandboxPointer("sess-1", {
      apiBase: "http://api:8000",
      authorization: "ApiKey abc",
      fetchImpl: (async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
      log: SILENT,
    });
    assert.equal(id, undefined);
  });

  it("ignores an empty-string id", async () => {
    const id = await readStoredSandboxPointer("sess-1", {
      apiBase: "http://api:8000",
      authorization: "ApiKey abc",
      fetchImpl: (async () =>
        okResponse({ turns: [{ sandbox_id: "" }] })) as unknown as typeof fetch,
      log: SILENT,
    });
    assert.equal(id, undefined);
  });
});
