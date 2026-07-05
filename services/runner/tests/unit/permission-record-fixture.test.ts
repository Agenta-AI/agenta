/**
 * Phase 4 (docs/design/agent-workflows/projects/pi-builtin-gating/plan.md): "The relay record
 * types are runtime files, not part of the `/run` golden wire, so no golden changes. Add a
 * small fixture test for the permission record round-trip."
 *
 * This pins the on-disk shape of the permission relay records: the REQUEST record
 * `{kind, protocol, toolName, toolCallId, args}` and the three RESPONSE verdict variants
 * (allow / deny+reason / pendingApproval+reason), each written to a temp relay dir and read
 * back exactly as `startToolRelay` and the extension's `relayPermissionCheck` would see them
 * over the filesystem. It also pins two parser boundaries in `parsePermissionRelayResponse`:
 * an unknown extra field must not break parsing (forward compatibility), and an execute-record
 * shape (no `kind`) must never be accepted as a permission response (the discriminated-union
 * boundary Phase 1 introduced so the two record kinds can never be cross-read).
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/permission-record-fixture.test.ts)
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  parsePermissionRelayResponse,
  RELAY_PERMISSION_PROTOCOL,
  type PermissionRelayResponse,
} from "../../src/tools/relay.ts";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function tempRelayDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "agenta-permission-record-fixture-"));
  dirs.push(dir);
  return dir;
}

/** Write `value` as JSON to `<dir>/<name>`, then read the bytes back off disk. Mirrors the
 *  relay's own file round trip (`host.write` then `host.read` in `tools/relay.ts`). */
function roundTripJson(
  dir: string,
  name: string,
  value: unknown,
): { raw: string; parsed: unknown } {
  const path = join(dir, name);
  const raw = JSON.stringify(value);
  writeFileSync(path, raw, "utf-8");
  const readBack = readFileSync(path, "utf-8");
  assert.equal(readBack, raw, "the bytes on disk match what was written exactly");
  return { raw: readBack, parsed: JSON.parse(readBack) };
}

describe("permission relay request record fixture", () => {
  it("round-trips the request record shape {kind, protocol, toolName, toolCallId, args}", () => {
    const dir = tempRelayDir();
    const request = {
      kind: "permission" as const,
      protocol: RELAY_PERMISSION_PROTOCOL,
      toolName: "bash",
      toolCallId: "call-42",
      args: { command: "npm test" },
    };

    const { parsed } = roundTripJson(dir, "call-42.req.json", request);

    assert.deepEqual(parsed, request);
  });
});

describe("permission relay response record fixture (allow / deny / pendingApproval)", () => {
  const variants: Array<{ name: string; response: PermissionRelayResponse }> = [
    {
      name: "allow",
      response: { kind: "permission", ok: true, verdict: "allow" },
    },
    {
      name: "deny with reason",
      response: {
        kind: "permission",
        ok: true,
        verdict: "deny",
        reason: "Tool 'bash' is denied by the permission policy.",
      },
    },
    {
      name: "pendingApproval with reason",
      response: {
        kind: "permission",
        ok: true,
        verdict: "pendingApproval",
        reason: "Waiting for approval of bash.",
      },
    },
  ];

  for (const { name, response } of variants) {
    it(`round-trips the ${name} response byte-stably through parsePermissionRelayResponse`, () => {
      const dir = tempRelayDir();
      const { raw, parsed } = roundTripJson(dir, "call-42.res.json", response);

      assert.deepEqual(parsed, response);

      const reparsed = parsePermissionRelayResponse(parsed);
      assert.deepEqual(reparsed, response);

      // Byte-stable: re-serializing the parsed record reproduces the exact bytes written to
      // disk, so there is no field reordering or silent coercion across the round trip.
      assert.equal(JSON.stringify(reparsed), raw);
    });
  }

  it("tolerates an unknown extra field without breaking parsing", () => {
    const dir = tempRelayDir();
    const withExtraField = {
      kind: "permission",
      ok: true,
      verdict: "allow",
      // A field a future protocol revision might add; today's parser must ignore it rather
      // than reject the whole record (forward compatibility across a runner/extension skew).
      futureField: "some-value-from-a-newer-runner",
    };

    const { parsed } = roundTripJson(dir, "call-99.res.json", withExtraField);

    assert.deepEqual(parsePermissionRelayResponse(parsed), {
      kind: "permission",
      ok: true,
      verdict: "allow",
    });
  });

  it("does NOT parse an execute-record shape {toolName, toolCallId, args} (no kind) as a permission response", () => {
    const dir = tempRelayDir();
    const executeRecord = {
      toolName: "server_tool",
      toolCallId: "call-1",
      args: { a: 1 },
    };

    const { parsed } = roundTripJson(dir, "call-1.req.json", executeRecord);

    assert.equal(parsePermissionRelayResponse(parsed), undefined);
  });
});
