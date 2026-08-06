/**
 * WIRE GUARANTEE FOR THE API MIGRATION, STEP 8: a domain failure must reach the MODEL.
 *
 * ============================================================================================
 * WHY THIS FILE EXISTS
 * ============================================================================================
 *
 * The migration moves `read_config` and `commit_revision` off their own routes and onto the
 * generic `POST /tools/call` seam, where their logic runs behind a registered handler. That
 * changes how a domain failure travels. Today it is a non-2xx whose FastAPI `detail` the runner
 * unwraps (`agentaErrorDetail`, tools/direct.ts). After the migration it is an HTTP **200**
 * carrying `STATUS_CODE_ERROR` and the canonical envelope in `ToolResult.content`:
 *
 *     {"code", "message", "retryable", "next_step"?, "details"?}
 *
 * That envelope is the whole reason a small model can recover from a bad commit by itself. If it
 * arrives looking like a success, the model reads an error object as the RESULT of its call.
 *
 * ============================================================================================
 * THE TRAP, MEASURED RATHER THAN PREDICTED
 * ============================================================================================
 *
 * `callAgentaTool` does not throw for a 200 that says STATUS_CODE_ERROR. It RETURNS a string, and
 * `startToolRelay` wraps any returned string as `{ ok: true, text }` (relay.ts), which the MCP
 * shim renders as `isError: false`. Probed in all three arms before this file was written:
 *
 *     status.message absent -> returned as success, text = the raw envelope JSON
 *     status.message null   -> returned as success, text = the raw envelope JSON
 *     status.message set    -> returned as success, text = "tool call <ref> failed: ...\n<envelope>"
 *
 * So every handler-mode domain failure currently reaches the model as a successful tool call.
 * This is the same defect class we removed one layer down, where a refused relay call travelled
 * as `{ok: true, text}` and Codex rendered it as a blank success: the model saw no error, invented
 * an explanation, and told the user to approve again.
 *
 * ============================================================================================
 * HOW TO READ THIS FILE
 * ============================================================================================
 *
 * `the trap, as it stands today` PASSES right now and pins the broken behavior. It is not an
 * endorsement of it. It exists so the defect is visible in the suite instead of living in a plan
 * document, and so nobody can land step 8 without deleting a test that says the opposite of what
 * they just built.
 *
 * `the guarantee` is SKIPPED and currently FAILS. It is the acceptance test for step 8. Unskip it
 * and delete the trap test in the same change that makes the runner treat `STATUS_CODE_ERROR` as
 * authoritative.
 *
 * SHAPE STATUS: CONFIRMED by verify-api ahead of their milestone 2. The envelope sits DIRECTLY in
 * `content` with no wrapper and no nested `reason`; an expected domain failure is always HTTP 200
 * with `STATUS_CODE_ERROR`; `code`, `message` and `retryable` are always present, `next_step`
 * whenever `retryable` is true and sometimes when it is false, and every error-specific field
 * lives in `details`. On success `content` carries the operation's own payload, which for
 * `read_config` is today's `ReadConfigResponse`.
 *
 * ONE ANSWER IS STILL OUTSTANDING: how an INFRASTRUCTURE failure is distinguished from a domain
 * one. Until that is settled the parser must not assume a `STATUS_CODE_ERROR` body is always a
 * well-formed envelope, which is what `a STATUS_CODE_ERROR whose content is not an envelope`
 * below exists to pin.
 *
 * DETECTION IS KEYED ON THE PAIR, NOT ON A CODE. verify-api's own recommendation, and it is the
 * right one: the runner recognizes a failure from (`status.code == "STATUS_CODE_ERROR"`, `content`
 * parsing to an object carrying `code` and `retryable`). No allowlist of codes, so adding a code
 * later needs no runner change and cannot silently arrive as a success.
 *
 * Run: pnpm exec vitest run tests/unit/handler-error-wire.test.ts
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ResolvedToolSpec } from "../../src/protocol.ts";
import {
  localRelayHost,
  startToolRelay,
  type RelayResponse,
} from "../../src/tools/relay.ts";

const ENDPOINT = "https://agenta.example/api/tools/call";

/**
 * The canonical envelope, verbatim from verify-api's confirmation.
 *
 * `revision_conflict` is the provocation because it is the one a live test can force with nothing
 * but a stale `base_revision_id`. Nothing here keys on that choice; see the header.
 */
const ENVELOPE = {
  code: "revision_conflict",
  message: "The workflow head changed. No revision was committed.",
  retryable: false,
  next_step:
    "Call read_config for the new revision, re-anchor your edits to it, and send the commit again with the new base_revision_id.",
  details: { base_revision_id: "019c-old", current_revision_id: "019c-new" },
};

/** A handler-mode platform op: it rides `/tools/call` by call ref, not its own route. */
const READ_CONFIG: ResolvedToolSpec = {
  name: "read_config",
  kind: "callback",
  callRef: "tools.agenta.read_config",
  permission: "allow",
  readOnly: true,
};

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Answer `/tools/call` with one canned `ToolResult`. */
function answerWith(content: unknown, status: Record<string, unknown>): void {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        call: {
          id: "00000000-0000-4000-8000-000000000000",
          data: {
            tool_call_id: "call-1",
            content: typeof content === "string" ? content : JSON.stringify(content),
          },
          status,
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as typeof fetch;
}

/**
 * A domain failure exactly as it will arrive: 200, `STATUS_CODE_ERROR`, the envelope in `content`,
 * and `status.message` mirroring the envelope's `message`.
 */
function answerWithDomainFailure(): void {
  answerWith(ENVELOPE, {
    code: "STATUS_CODE_ERROR",
    message: ENVELOPE.message,
  });
}

/** Drive one call through the REAL relay and return what the model would read. */
async function throughTheRelay(spec: ResolvedToolSpec): Promise<RelayResponse> {
  const dir = mkdtempSync(join(tmpdir(), "agenta-handler-wire-"));
  try {
    const relay = startToolRelay(localRelayHost(), dir, [spec], {
      endpoint: ENDPOINT,
      authorization: "ApiKey secret",
    });
    writeFileSync(
      join(dir, "call-1.req.json"),
      JSON.stringify({
        toolName: spec.name,
        toolCallId: "call-1",
        args: { target: { path: ["parameters", "agent", "instructions"] } },
      }),
    );
    const resPath = join(dir, "call-1.res.json");
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

describe("a handler-mode domain failure on the way to the model", () => {
  it("a STATUS_CODE_ERROR reads as an ERROR, and keeps the text the model used to get", async () => {
    // THE GATEWAY FIX, and the one test here that is not waiting on the migration. Any tool that
    // rides `/tools/call` fails this way, so this covers every Composio tool on every harness as
    // well as the handler-mode ops the migration adds.
    //
    // This test used to assert the opposite. It pinned the defect, because a failure travelled as
    // `{ok: true, text}` and the MCP shim renders that as `isError: false`: the model was told its
    // call SUCCEEDED and handed the failure text as the result.
    //
    // Both halves matter. `ok: false` is the signal. The text is the content, and it must not
    // shrink: a model that is told only "it failed" cannot correct its arguments, which is the
    // whole reason the gateway puts a reason there.
    answerWithDomainFailure();
    const res = await throughTheRelay(READ_CONFIG);

    assert.equal(res.ok, false, "a failure must read as a failure");
    const error = String((res as { error: string }).error);
    assert.ok(error.includes(ENVELOPE.message), "the headline survives");
    assert.ok(error.includes("revision_conflict"), "the content survives");
  });

  it.skip("the guarantee: it arrives as an ERROR carrying code, next_step and details", async () => {
    // UNSKIP WITH STEP 8. This is the acceptance test for the migration's P0. It fails today.
    //
    // What it demands, and why each part:
    //  - `ok: false`, because that is the only thing the shim turns into `isError: true`. Without
    //    it the model has no signal that anything went wrong.
    //  - `code`, because it is what the model branches on.
    //  - `next_step`, because it is the one-step recovery a small model needs; a refusal without
    //    it produces a guess.
    //  - a field out of `details`, because the plan puts every error-specific value there and a
    //    parser that drops the object would still pass the first three assertions.
    answerWithDomainFailure();
    const res = await throughTheRelay(READ_CONFIG);

    assert.equal(res.ok, false, "a domain failure must read as an error, not as a result");
    const error = String((res as { error: string }).error);
    assert.ok(error.includes("revision_conflict"), "the model must see the code");
    assert.ok(
      error.includes("re-anchor your edits"),
      "the model must see the next step",
    );
    assert.ok(
      error.includes("019c-new"),
      "the model must see details, not just the headline",
    );
  });

  it("it is detected WITHOUT status.message, which the runner must not depend on", async () => {
    // The arm the old code got wrong, and the reason the fix keys on `status.code` alone.
    // `callAgentaTool` used to require `status.message` to be a STRING before it noticed a
    // failure, so a failure whose message was absent or null fell straight through to the success
    // return. Anyone extending that line rather than replacing it would pass every other test here
    // and still ship a runner that reports success the moment the API stops mirroring the message.
    answerWith(ENVELOPE, { code: "STATUS_CODE_ERROR" });
    const res = await throughTheRelay(READ_CONFIG);

    assert.equal(res.ok, false, "the status code alone must be enough");
    assert.ok(String((res as { error: string }).error).includes("revision_conflict"));
  });

  it("a STATUS_CODE_ERROR whose content is NOT an envelope still fails, and keeps its text", async () => {
    // The tolerance case, and it is the common one rather than an edge. Two arms of the tools
    // router still answer a failure with `STATUS_CODE_ERROR` and a content that is NOT the
    // canonical envelope, and both must read as failures anyway:
    //
    //   - the gateway/Composio arm, which sends `ToolExecutionResponse` ({data, error,
    //     successful}) with the upstream reason in `status.message`;
    //   - the workflow-tool arm, which sends the workflow's own `outputs`.
    //
    // `test_run` USED to be a third. It was converted to the envelope in the API's milestone 2,
    // so it is no longer an example here; the other two are unchanged at the time of writing.
    // If they are ever converted too, this test keeps its value as the guard on an unhandled
    // path rather than on our own inconsistency.
    //
    // A CORRECTION TO WHAT I FIRST TOLD VERIFY-API. I said the runner would redact a content that
    // did not parse as an envelope, reasoning by analogy with `agentaErrorDetail` in
    // tools/direct.ts. That was wrong here, for two reasons. To reach this line the body already
    // parsed as our own `ToolCallResponse`, so `content` came from our API rather than from a
    // proxy; a proxy's HTML page fails the JSON parse above and a non-2xx is redacted to its
    // status code further up. And redacting would delete the gateway's reason, which is the one
    // thing that lets the model fix its arguments. So the text passes through.
    answerWith("upstream rejected the argument 'channel': not a member", {
      code: "STATUS_CODE_ERROR",
      message: "action failed",
    });
    const res = await throughTheRelay(READ_CONFIG);

    assert.equal(res.ok, false, "a non-envelope failure is still a failure");
    const error = String((res as { error: string }).error);
    assert.ok(error.includes("action failed"), "the headline survives");
    assert.ok(
      error.includes("not a member"),
      "the upstream reason survives, because it is what the model acts on",
    );
  });

  it.skip("a SUCCESS still reads as a success, so the fix cannot fail everything closed", async () => {
    // UNSKIP WITH STEP 8. The control. A guard that turned every handler result into an error
    // would satisfy every test above and break the product, so the success arm is pinned beside
    // them. The payload is `ReadConfigResponse`, which is what `content` carries on this op.
    answerWith(
      {
        revision: { id: "019c-old" },
        base_revision_id: "019c-old",
        is_draft: false,
        path: ["parameters", "agent", "instructions"],
        value: "Be terse.",
        bytes: 9,
      },
      { code: "STATUS_CODE_OK" },
    );

    const res = await throughTheRelay(READ_CONFIG);
    assert.equal(res.ok, true);
    assert.ok(String((res as { text: string }).text).includes("Be terse."));
  });
});
