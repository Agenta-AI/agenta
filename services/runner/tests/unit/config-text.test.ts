/**
 * The approval card's OLD-side fetcher, after the API migration moved it to `/tools/call`.
 *
 * This helper had NO direct coverage before step 8, which is why it gets a file now: changing a
 * component's transport with nothing asserting its behavior is how a card quietly starts diffing
 * against the wrong text. Two things are worth pinning, and only one of them is the transport.
 *
 * THE TRANSPORT. It used to POST `/api/workflows/revisions/read-config`. It now sends the
 * `tools.agenta.read_config` call ref through the generic tool seam, with the SAME body, because
 * `handle_read_config` reads the same `target` and `max_bytes` the route did.
 *
 * THE REFUSALS, WHICH MATTER MORE. The card exists so a human sees what a commit replaces. Every
 * refusal below is a case where the runner cannot show that honestly, and each one must fail
 * rather than diff against the wrong side. The base-revision check is the sharpest: the session
 * may run revision N while the model correctly supplies head N+1, and diffing against N would
 * show the human an N-to-new change, pass the base check, and replace N+1 with text nobody
 * compared against it. Nothing fails and the wrong thing commits.
 *
 * Run: pnpm exec vitest run tests/unit/config-text.test.ts
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";

import { buildConfigTextFetcher } from "../../src/tools/config-text.ts";

const ENDPOINT = "https://agenta.example/api/tools/call";
const VARIANT = "019c-variant";

const runContext = {
  workflow: { variant: { id: VARIANT }, is_draft: false },
} as never;

interface Sent {
  url: string;
  body: any;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Capture the request and answer with one canned tool result. */
function stub(content: unknown, status: Record<string, unknown>): Sent[] {
  const sent: Sent[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
    return new Response(
      JSON.stringify({
        call: {
          data: {
            tool_call_id: "t",
            content:
              typeof content === "string" ? content : JSON.stringify(content),
          },
          status,
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  return sent;
}

const OK = { code: "STATUS_CODE_OK" };

const readConfigResponse = (overrides: Record<string, unknown> = {}) => ({
  revision: { id: "rev-1" },
  base_revision_id: "rev-1",
  is_draft: false,
  path: ["parameters", "agent", "instructions", "agents_md"],
  value: "Be terse.",
  bytes: 9,
  ...overrides,
});

const fetcher = () =>
  buildConfigTextFetcher({
    callback: { endpoint: ENDPOINT, authorization: "ApiKey secret" } as never,
    runContext,
  });

describe("the config-text fetcher rides the tool seam", () => {
  it("sends the read call ref, not a route path, and binds the run's own variant", async () => {
    // The variant is filled by the RUNNER from run context, never by the model, and the handler
    // fails closed without it (`_bound_variant_id`). So it must be in `target`, where the handler
    // looks, and it must be this run's.
    const sent = stub(readConfigResponse(), OK);
    const text = await fetcher()({
      revisionId: "rev-1",
      target: ["parameters", "agent", "instructions", "agents_md"],
    });

    assert.equal(text, "Be terse.");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, ENDPOINT, "it posts to /tools/call itself");
    assert.equal(sent[0].body.data.function.name, "tools.agenta.read_config");
    const args = sent[0].body.data.function.arguments;
    assert.equal(args.target.workflow_variant_id, VARIANT);
    assert.deepEqual(args.target.path, [
      "parameters",
      "agent",
      "instructions",
      "agents_md",
    ]);
    assert.equal(args.target.run_is_draft, false);
    assert.equal(typeof args.max_bytes, "number");
  });

  it("passes a domain failure through as a throw carrying the envelope", async () => {
    // The migration's whole point, seen from this caller. The route used to answer a non-2xx and
    // the reason came out of FastAPI's `detail`; the handler answers 200 with the envelope, and
    // `callAgentaTool` turns that into a throw. Either way the caller sees a throw, so the card
    // fails closed and the reason survives.
    stub(
      {
        code: "revision_not_found",
        message: "No such revision.",
        retryable: false,
        next_step: "Call read_config without a revision to get the head.",
        details: { base_revision_id: "rev-9" },
      },
      { code: "STATUS_CODE_ERROR", message: "No such revision." },
    );

    await assert.rejects(
      () => fetcher()({ revisionId: "rev-9", target: ["parameters"] }),
      (err: Error) => {
        assert.ok(err.message.includes("revision_not_found"));
        assert.ok(err.message.includes("Call read_config without a revision"));
        return true;
      },
    );
  });
});

describe("the fetcher refuses rather than diff against the wrong side", () => {
  it("refuses when the head moved away from the base the operation names", async () => {
    // The hole this check exists for, in one line: the commit's base is a precondition, so a
    // commit whose base is not the head cannot succeed anyway. The conflict simply surfaces one
    // step earlier, before a human is shown a diff that describes a different change.
    stub(readConfigResponse({ base_revision_id: "rev-2" }), OK);

    await assert.rejects(
      () => fetcher()({ revisionId: "rev-1", target: ["parameters"] }),
      (err: Error) => {
        assert.match(err.message, /moved to revision rev-2/);
        assert.match(err.message, /targets rev-1/);
        return true;
      },
    );
  });

  it("refuses when the target does not hold text", async () => {
    // A `set` from a file replaces a field that already holds a string. Anything else means the
    // target names something a diff cannot describe.
    stub(readConfigResponse({ value: { nested: "object" } }), OK);

    await assert.rejects(
      () => fetcher()({ revisionId: "rev-1", target: ["parameters", "agent"] }),
      (err: Error) => {
        assert.match(err.message, /does not currently hold text/);
        return true;
      },
    );
  });

  it("refuses a malformed answer instead of treating it as empty", async () => {
    stub("not json at all", OK);

    await assert.rejects(
      () => fetcher()({ revisionId: "rev-1", target: ["parameters"] }),
      (err: Error) => {
        assert.match(err.message, /malformed response/);
        return true;
      },
    );
  });

  it("refuses when the run has no variant to read", async () => {
    // Fails closed on the runner side too, so a run without a bound variant never reaches the
    // handler's own refusal.
    const sent = stub(readConfigResponse(), OK);
    const noVariant = buildConfigTextFetcher({
      callback: { endpoint: ENDPOINT, authorization: "ApiKey secret" } as never,
      runContext: { workflow: {} } as never,
    });

    await assert.rejects(
      () => noVariant({ revisionId: "rev-1", target: ["parameters"] }),
      (err: Error) => {
        assert.match(err.message, /no workflow variant to read/);
        return true;
      },
    );
    assert.equal(sent.length, 0, "and it never leaves the runner");
  });

  it("refuses when the run has no callback endpoint", async () => {
    const noEndpoint = buildConfigTextFetcher({
      callback: undefined,
      runContext,
    });
    await assert.rejects(
      () => noEndpoint({ revisionId: "rev-1", target: ["parameters"] }),
      (err: Error) => {
        assert.match(err.message, /no Agenta callback endpoint/);
        return true;
      },
    );
  });
});
