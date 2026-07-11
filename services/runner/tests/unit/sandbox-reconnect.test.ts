/**
 * Unit tests for the sandbox-id read/write helpers that back the remote reconnect ladder.
 * Exercised through injected fetch/deps -- no real HTTP.
 *
 * Run: pnpm exec vitest run tests/unit/sandbox-reconnect.test.ts
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  clearSandboxPointer,
  readStoredSandboxPointer,
  writeSandboxPointer,
} from "../../src/engines/sandbox_agent/sandbox-reconnect.ts";

const SILENT = () => {};

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function errResponse(status: number): Response {
  return { ok: false, status, json: async () => ({}) } as unknown as Response;
}

describe("readStoredSandboxPointer", () => {
  it("returns the stored pointer from the durable row", async () => {
    const pointer = await readStoredSandboxPointer("sess-1", {
      apiBase: "http://api:8000",
      authorization: "ApiKey abc",
      fetchImpl: (async () =>
        okResponse({
          session_state: {
            sandbox_id: "sbx-42",
          },
        })) as unknown as typeof fetch,
      log: SILENT,
    });
    assert.deepEqual(pointer, { sandboxId: "sbx-42" });
  });

  it("returns undefined when the row has no sandbox_id", async () => {
    const id = await readStoredSandboxPointer("sess-1", {
      apiBase: "http://api:8000",
      authorization: "ApiKey abc",
      fetchImpl: (async () =>
        okResponse({ session_state: { sandbox_id: null } })) as unknown as typeof fetch,
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
        okResponse({ session_state: { sandbox_id: "" } })) as unknown as typeof fetch,
      log: SILENT,
    });
    assert.equal(id, undefined);
  });
});

describe("clearSandboxPointer", () => {
  it("PUTs null pointer fields with the guard token", async () => {
    let body: Record<string, unknown> | undefined;
    const outcome = await clearSandboxPointer("sess-1", 7, {
      apiBase: "http://api:8000",
      authorization: "ApiKey abc",
      fetchImpl: (async (_url: string, init?: RequestInit) => {
        body = JSON.parse(init!.body as string);
        return okResponse({ session_state: { sandbox_id: null } });
      }) as unknown as typeof fetch,
      log: SILENT,
    });

    assert.deepEqual(body, {
      sandbox_id: null,
      sandbox_turn_index: 7,
    });
    assert.equal(outcome, "applied");
  });
});

describe("writeSandboxPointer", () => {
  it("PUTs the sandbox pointer and guard token on the row", async () => {
    let body: Record<string, unknown> | undefined;
    const outcome = await writeSandboxPointer("sess-1", {
      sandboxId: "sbx-42",
      turnIndex: 3,
    }, {
      apiBase: "http://api:8000",
      authorization: "ApiKey abc",
      fetchImpl: (async (_url: string, init?: RequestInit) => {
        body = JSON.parse(init!.body as string);
        return okResponse({ session_state: { sandbox_id: "sbx-42" } });
      }) as unknown as typeof fetch,
      log: SILENT,
    });
    assert.deepEqual(body, {
      sandbox_id: "sbx-42",
      sandbox_turn_index: 3,
    });
    assert.equal(outcome, "applied");
  });

  it("returns rejected when the response keeps another sandbox id", async () => {
    const outcome = await writeSandboxPointer("sess-1", {
      sandboxId: "sbx-stale",
      turnIndex: 1,
    }, {
      apiBase: "http://api:8000",
      authorization: "ApiKey abc",
      fetchImpl: (async () =>
        okResponse({ session_state: { sandbox_id: "sbx-current" } })) as unknown as typeof fetch,
      log: SILENT,
    });
    assert.equal(outcome, "rejected");
  });

  it("never throws when the PUT fails", async () => {
    await assert.doesNotReject(() =>
      writeSandboxPointer("sess-1", { sandboxId: "sbx-42", turnIndex: 0 }, {
        apiBase: "http://api:8000",
        authorization: "ApiKey abc",
        fetchImpl: (async () => errResponse(503)) as unknown as typeof fetch,
        log: SILENT,
      }),
    );
  });

  it("never throws when fetch throws", async () => {
    await assert.doesNotReject(() =>
      writeSandboxPointer("sess-1", { sandboxId: "sbx-42", turnIndex: 0 }, {
        apiBase: "http://api:8000",
        authorization: "ApiKey abc",
        fetchImpl: (async () => {
          throw new Error("ECONNREFUSED");
        }) as unknown as typeof fetch,
        log: SILENT,
      }),
    );
  });
});
