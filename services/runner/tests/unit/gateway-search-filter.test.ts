/**
 * Search visibility: qa.md A6 and R22 to R28.
 *
 * Filtering is not the execution boundary — `run_tool` independently checks every requested
 * tool — but it is what keeps the model from spending a turn on an action it will then be
 * refused, and it is what keeps the provider's whole catalog out of the conversation.
 *
 * R28 asserts on the SERIALIZED payload, not on the object the runner built. A whitelist that
 * rebuilds each result is only worth something if what leaves the runner is what the whitelist
 * produced, and a field added to the API's result shape later must not appear by default.
 *
 * A6 lives here rather than with the API tests because only the runner holds the configured
 * set: the API would happily search a provider toolkit this agent has no connection to.
 *
 * Run: pnpm exec vitest run tests/unit/gateway-search-filter.test.ts
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  EMPTY_SEARCH_MESSAGE,
  MAX_SEARCH_RESULTS,
  REDACTED_TOOL_TOKEN,
  TOOL_SEARCH_UNAVAILABLE_ERROR,
  filterGatewaySearchResult,
  keptToolTokenMap,
  planGatewaySearch,
  redactUnpermittedToolTokens,
} from "../../src/tools/gateway-policy.ts";
import {
  EMPTY_POLICY,
  NORMALIZED_POLICY,
  SEARCH_TOOL_SPEC,
  cleanupRelayDirs,
  forgeRelayRequest,
  gatewayLogs,
  readRelayResponse,
  startGatewayRelay,
  stubToolCall,
} from "../utils/gateway.ts";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  cleanupRelayDirs();
});

const OBJECT_SCHEMA = {
  type: "object",
  properties: { issue: { type: "number" } },
  required: ["issue"],
};

function result(
  integration: string,
  tool: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    integration,
    tool,
    name: tool,
    description: `${tool} on ${integration}`,
    input_schema: OBJECT_SCHEMA,
    ...extra,
  };
}

function filter(
  results: unknown[],
): ReturnType<typeof filterGatewaySearchResult> {
  return filterGatewaySearchResult(
    JSON.stringify({ results }),
    NORMALIZED_POLICY,
  );
}

describe("the five filters (R22 to R26)", () => {
  it("R22: a result from an unconfigured integration is removed", () => {
    const outcome = filter([
      result("stripe", "CREATE_CHARGE"),
      result("github", "GET_ISSUE"),
    ]);

    assert.equal(outcome.kept, 1);
    assert.equal(outcome.drops.unconfigured, 1);
    assert.ok(!outcome.payload.includes("stripe"));
  });

  it("R23: a result whose tool key is missing from the policy is removed", () => {
    const outcome = filter([
      result("github", "FORCE_PUSH"),
      result("github", "GET_ISSUE"),
    ]);

    assert.equal(outcome.kept, 1);
    assert.equal(outcome.drops.unknownTool, 1);
  });

  it("R24: a result whose compiled permission is deny is removed", () => {
    const outcome = filter([
      result("github", "DELETE_REPOSITORY"),
      result("github", "GET_ISSUE"),
    ]);

    assert.equal(outcome.kept, 1);
    assert.equal(outcome.drops.denied, 1);
    assert.ok(!outcome.payload.includes("DELETE_REPOSITORY"));
  });

  it("R25: a result with no usable object input schema is removed", () => {
    const outcome = filter([
      result("github", "GET_ISSUE", { input_schema: "a string" }),
      result("github", "CREATE_ISSUE", { input_schema: { type: "array" } }),
      result("github", "LIST_ISSUES", { input_schema: {} }),
      result("slack", "SEND_MESSAGE"),
    ]);

    assert.equal(outcome.kept, 1);
    assert.equal(outcome.drops.schema, 3);
  });

  it("keeps a schema that declares properties without an explicit type", () => {
    const outcome = filter([
      result("github", "GET_ISSUE", {
        input_schema: { properties: { issue: { type: "number" } } },
      }),
    ]);

    assert.equal(outcome.kept, 1);
  });

  it("R26: at most five results reach the model", () => {
    const many = [
      result("github", "GET_ISSUE"),
      result("github", "CREATE_ISSUE"),
      result("github", "LIST_ISSUES"),
      result("slack", "SEND_MESSAGE"),
      result("slack", "GET_ISSUE"),
      result("github", "GET_ISSUE"),
      result("github", "CREATE_ISSUE"),
      result("github", "LIST_ISSUES"),
      result("slack", "SEND_MESSAGE"),
      result("slack", "GET_ISSUE"),
    ];
    const outcome = filter(many);

    assert.equal(outcome.total, 10);
    assert.equal(outcome.kept, MAX_SEARCH_RESULTS);
    assert.equal(outcome.drops.capped, 5);
    assert.equal(
      (JSON.parse(outcome.payload).results as unknown[]).length,
      MAX_SEARCH_RESULTS,
    );
  });
});

describe("what the model gets when nothing survives (R27)", () => {
  it("R27: an empty list carries the short message and names no unconfigured integration", () => {
    const outcome = filter([
      result("stripe", "CREATE_CHARGE"),
      result("notion", "CREATE_PAGE"),
      result("github", "DELETE_REPOSITORY"),
    ]);

    assert.deepEqual(JSON.parse(outcome.payload), {
      results: [],
      message: EMPTY_SEARCH_MESSAGE,
    });
    for (const leak of ["stripe", "notion", "DELETE_REPOSITORY"]) {
      assert.ok(!outcome.payload.includes(leak));
    }
  });

  it("a body that is not the search result object becomes the search-failure envelope", () => {
    for (const raw of ["not json at all", '{"error": "boom"}', "[]"]) {
      const outcome = filterGatewaySearchResult(raw, NORMALIZED_POLICY);
      assert.equal(outcome.unparsable, true);
      assert.deepEqual(
        JSON.parse(outcome.payload),
        TOOL_SEARCH_UNAVAILABLE_ERROR,
      );
    }
  });
});

describe("R28: the serialized payload carries nothing private", () => {
  it("drops every field the contract forbids, including ones added later", () => {
    const outcome = filter([
      result("github", "GET_ISSUE", {
        connection: "github-work",
        connection_slug: "github-work",
        provider_account_id: "acct_123",
        provider_action_id: "GITHUB_GET_ISSUE",
        permission: "allow",
        read_only: true,
        // A field the API might add tomorrow: the whitelist must not carry it either.
        internal_hint: "surprise",
      }),
    ]);

    assert.equal(outcome.kept, 1);
    for (const leak of [
      "github-work",
      "acct_123",
      "GITHUB_GET_ISSUE",
      "permission",
      "read_only",
      "internal_hint",
    ]) {
      assert.ok(
        !outcome.payload.includes(leak),
        `the serialized payload must not carry '${leak}': ${outcome.payload}`,
      );
    }
    assert.deepEqual(JSON.parse(outcome.payload), {
      results: [
        {
          integration: "github",
          tool: "GET_ISSUE",
          name: "GET_ISSUE",
          description: "GET_ISSUE on github",
          input_schema: OBJECT_SCHEMA,
        },
      ],
    });
  });

  it("writes the filtered payload back on the wire, not the API's own body", async () => {
    const relay = await startGatewayRelay();
    stubToolCall({
      results: [
        result("stripe", "CREATE_CHARGE"),
        result("github", "DELETE_REPOSITORY"),
        result("github", "GET_ISSUE", { provider_action_id: "GITHUB_GET" }),
      ],
    });
    try {
      await forgeRelayRequest(
        relay.dir,
        "search-1",
        { query: "read an issue" },
        SEARCH_TOOL_SPEC.name,
      );
      const response = await readRelayResponse(relay.dir, "search-1");

      assert.equal(response.ok, true);
      const payload = JSON.parse(response.text as string);
      assert.equal(payload.results.length, 1);
      assert.equal(payload.results[0].tool, "GET_ISSUE");
      assert.ok(!String(response.text).includes("GITHUB_GET"));
      assert.ok(!String(response.text).includes("stripe"));
    } finally {
      await relay.stop();
    }
  });
});

/**
 * The measurements slice 7 reports from. An untested log line rots, and these are the numbers
 * that answer "is search steering the model, or is it guessing keys".
 */
describe("the structured measurement lines", () => {
  it("logs the drop counts by reason, then the rank the model ran", async () => {
    const relay = await startGatewayRelay();
    stubToolCall({
      results: [
        result("stripe", "CREATE_CHARGE"),
        result("github", "DELETE_REPOSITORY"),
        result("github", "FORCE_PUSH"),
        result("github", "CREATE_ISSUE", { input_schema: "unusable" }),
        result("github", "LIST_ISSUES"),
        result("github", "GET_ISSUE"),
      ],
    });
    try {
      await forgeRelayRequest(
        relay.dir,
        "measure-search",
        { query: "read an issue" },
        SEARCH_TOOL_SPEC.name,
      );
      await readRelayResponse(relay.dir, "measure-search");

      const [searchLine] = gatewayLogs(relay.relayLogs);
      assert.match(searchLine, /^\[gateway\] search results=6 kept=2 /);
      assert.match(
        searchLine,
        /unconfigured=1 unknown=1 denied=1 schema=1 capped=0 unparsable=false$/,
      );

      // The model then runs the SECOND result search offered it.
      stubToolCall({ issue: 12 });
      await forgeRelayRequest(relay.dir, "measure-run", {
        integration: "github",
        tool: "GET_ISSUE",
        arguments: { issue: 12 },
      });
      await readRelayResponse(relay.dir, "measure-run");

      const gateLine = gatewayLogs(relay.relayLogs).find((line) =>
        line.includes("gate integration="),
      );
      assert.ok(gateLine);
      assert.match(
        gateLine,
        /tool=GET_ISSUE permission=allow outcome=allow rank=2 searches=1$/,
      );
    } finally {
      await relay.stop();
    }
  });

  it("reports rank=-1 and searches=0 when the model ran a key it never searched for", async () => {
    const relay = await startGatewayRelay();
    stubToolCall({ issue: 12 });
    try {
      await forgeRelayRequest(relay.dir, "blind-run", {
        integration: "github",
        tool: "GET_ISSUE",
        arguments: { issue: 12 },
      });
      await readRelayResponse(relay.dir, "blind-run");

      const [gateLine] = gatewayLogs(relay.relayLogs);
      assert.match(gateLine, /rank=-1 searches=0$/);
    } finally {
      await relay.stop();
    }
  });
});

/**
 * Filtering the results does not finish the job. A provider writes each description against its
 * OWN catalog, so a tool the agent MAY run recommends alternatives it may not — live, the
 * permitted `SEND_DRAFT` named `GMAIL_SEND_EMAIL` as the way to send immediately. That is the
 * same enumeration every refusal in this feature avoids, arriving through prose instead.
 */
describe("descriptions do not name tools this response did not permit", () => {
  it("redacts a provider action id that is not among the kept results", () => {
    const outcome = filterGatewaySearchResult(
      JSON.stringify({
        results: [
          result("github", "GET_ISSUE", {
            description:
              "Read one issue. To change it use GITHUB_UPDATE_ISSUE, or " +
              "GITHUB_DELETE_ISSUE to remove it.",
          }),
        ],
      }),
      NORMALIZED_POLICY,
    );

    const [kept] = JSON.parse(outcome.payload).results;
    assert.equal(
      kept.description,
      `Read one issue. To change it use ${REDACTED_TOOL_TOKEN}, or ${REDACTED_TOOL_TOKEN} to remove it.`,
    );
    assert.ok(!outcome.payload.includes("GITHUB_UPDATE_ISSUE"));
    assert.ok(!outcome.payload.includes("GITHUB_DELETE_ISSUE"));
  });

  it("keeps a token that IS permitted in the same response", () => {
    const outcome = filterGatewaySearchResult(
      JSON.stringify({
        results: [
          result("github", "GET_ISSUE", {
            description: "Read one issue. See also LIST_ISSUES.",
          }),
          result("github", "LIST_ISSUES"),
        ],
      }),
      NORMALIZED_POLICY,
    );

    const [first] = JSON.parse(outcome.payload).results;
    assert.equal(first.description, "Read one issue. See also LIST_ISSUES.");
  });

  it("rewrites a PREFIXED mention of a kept tool to the key run_tool accepts", () => {
    // The live failure: the provider writes `GMAIL_FETCH_EMAILS`, the model reads it as a tool
    // key and passes it to `run_tool`, and the gate refuses it — on a tool it was permitted to
    // run. The description must name the key the gate will actually accept.
    const outcome = filterGatewaySearchResult(
      JSON.stringify({
        results: [
          result("github", "GET_ISSUE", {
            description:
              "Read one issue. Use GITHUB_LIST_ISSUES to list them all.",
          }),
          result("github", "LIST_ISSUES"),
        ],
      }),
      NORMALIZED_POLICY,
    );

    const [first] = JSON.parse(outcome.payload).results;
    assert.equal(
      first.description,
      "Read one issue. Use LIST_ISSUES to list them all.",
      "a kept mention must render as a key the model can pass to run_tool",
    );
    assert.ok(!outcome.payload.includes("GITHUB_LIST_ISSUES"));
  });

  it("a prefixed mention of a tool this response did NOT keep is still dropped", () => {
    // The rewrite must not resurrect a tool the filter removed: only kept results are in the map.
    const outcome = filterGatewaySearchResult(
      JSON.stringify({
        results: [
          result("github", "GET_ISSUE", {
            description: "Read one issue. GITHUB_DELETE_REPOSITORY removes it.",
          }),
        ],
      }),
      NORMALIZED_POLICY,
    );

    const [first] = JSON.parse(outcome.payload).results;
    assert.equal(
      first.description,
      `Read one issue. ${REDACTED_TOOL_TOKEN} removes it.`,
    );
    assert.ok(!outcome.payload.includes("DELETE_REPOSITORY"));
  });

  it("redacts a DENIED tool named in a permitted tool's description", () => {
    const outcome = filterGatewaySearchResult(
      JSON.stringify({
        results: [
          result("github", "GET_ISSUE", {
            description: "Read one issue. DELETE_REPOSITORY removes the repo.",
          }),
        ],
      }),
      NORMALIZED_POLICY,
    );

    assert.ok(!outcome.payload.includes("DELETE_REPOSITORY"));
  });

  it("a result whose own key appears in its description keeps it", () => {
    const outcome = filterGatewaySearchResult(
      JSON.stringify({
        results: [
          result("github", "GET_ISSUE", {
            description: "GET_ISSUE reads one issue.",
          }),
        ],
      }),
      NORMALIZED_POLICY,
    );

    const [kept] = JSON.parse(outcome.payload).results;
    assert.equal(kept.description, "GET_ISSUE reads one issue.");
  });
});

describe("the redaction leaves ordinary prose alone", () => {
  const permitted = keptToolTokenMap([
    { integration: "github", tool: "GET_ISSUE" },
  ]);

  it("keeps shouted words that carry no underscore", () => {
    // The underscore is the whole reason this is safe to run over free text.
    const text = "Returns HTML or JSON over HTTP; see the API docs at the URL.";
    assert.equal(redactUnpermittedToolTokens(text, permitted), text);
  });

  it("keeps ordinary words, snake_case, and CamelCase", () => {
    const text = "Set is_html to true, then call getIssue on the Issue object.";
    assert.equal(redactUnpermittedToolTokens(text, permitted), text);
  });

  it("redacts every unpermitted occurrence, not just the first", () => {
    assert.equal(
      redactUnpermittedToolTokens("SEND_MAIL then SEND_MAIL again", permitted),
      `${REDACTED_TOOL_TOKEN} then ${REDACTED_TOOL_TOKEN} again`,
    );
  });

  it("is a no-op on a description with nothing to redact", () => {
    assert.equal(
      redactUnpermittedToolTokens("Reads one issue.", permitted),
      "Reads one issue.",
    );
  });
});

describe("A6: an unconfigured integration is rejected before the callback", () => {
  it("refuses the search and names the connected integrations instead", () => {
    const plan = planGatewaySearch(
      { query: "charge a card", integration: "stripe" },
      NORMALIZED_POLICY,
    );

    assert.equal(plan.ok, false);
    const reason = (plan as { reason: string }).reason;
    assert.ok(reason.includes("github"));
    assert.ok(reason.includes("slack"));
  });

  it("the provider is never called", async () => {
    const relay = await startGatewayRelay();
    const calls = stubToolCall({ results: [] });
    try {
      await forgeRelayRequest(
        relay.dir,
        "search-stripe",
        { query: "charge a card", integration: "stripe" },
        SEARCH_TOOL_SPEC.name,
      );
      const response = await readRelayResponse(relay.dir, "search-stripe");

      assert.equal(response.ok, false);
      assert.equal(calls.bodies.length, 0);
    } finally {
      await relay.stop();
    }
  });

  it("a configured integration scopes the search and routes on its provider", () => {
    const plan = planGatewaySearch(
      { query: "post a message", integration: "slack" },
      NORMALIZED_POLICY,
    );

    assert.ok(plan.ok);
    assert.deepEqual(plan.arguments, {
      query: "post a message",
      integration: "slack",
    });
    assert.deepEqual(plan.context, {
      provider: "composio",
      integration: "slack",
    });
  });

  it("an unscoped search sends the query alone, with no connection in the context", () => {
    const plan = planGatewaySearch(
      { query: "read an issue" },
      NORMALIZED_POLICY,
    );

    assert.ok(plan.ok);
    assert.deepEqual(plan.arguments, { query: "read an issue" });
    assert.equal(plan.context.connection, undefined);
    assert.equal(plan.context.tool, undefined);
  });

  it("refuses a search with no usable query", () => {
    assert.equal(
      planGatewaySearch({ query: "  " }, NORMALIZED_POLICY).ok,
      false,
    );
    assert.equal(planGatewaySearch({}, NORMALIZED_POLICY).ok, false);
    assert.equal(
      planGatewaySearch({ query: "anything" }, EMPTY_POLICY).ok,
      false,
    );
  });
});
