/**
 * Policy intake, and the search failure that must not leak: the two P2 findings.
 *
 * INTAKE. `gatewayPolicy` arrives over the wire. A reader that checks only the fields it happens
 * to use lets a half-valid entry through one door while another door rejects it — a missing
 * `connection` reaching a callback, a missing `permission` passing a filter written as "anything
 * but deny". So the whole policy is validated ONCE and every consumer reads the result. These
 * tests drive each consumer with a policy that is broken in one way and assert that all of them
 * agree the entry does not exist.
 *
 * SEARCH FAILURE. The API answers a failed search with its own error envelope over HTTP 200,
 * which the callback transport raises as a throw — BEFORE the filter can run. Left alone that
 * detail goes straight to the model, which is the one passthrough the search contract does not
 * allow: it can name a toolkit this agent never configured.
 *
 * Run: pnpm exec vitest run tests/unit/gateway-policy-intake.test.ts
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  TOOL_SEARCH_UNAVAILABLE_ERROR,
  filterGatewaySearchResult,
  normalizeGatewayPolicy,
  planGatewayRun,
  planGatewaySearch,
  sanitizeGatewayRunError,
} from "../../src/tools/gateway-policy.ts";
import {
  EMPTY_POLICY,
  SEARCH_TOOL_SPEC,
  cleanupRelayDirs,
  forgeRelayRequest,
  readRelayResponse,
  startGatewayRelay,
  stubToolCall,
  stubToolError,
} from "../utils/gateway.ts";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  cleanupRelayDirs();
});

/** A policy whose single integration is valid except for the one thing under test. */
function policyWith(overrides: Record<string, unknown>): unknown {
  return {
    integrations: {
      github: {
        provider: "composio",
        connection: "github-work",
        tools: { GET_ISSUE: { permission: "allow", readOnly: true } },
        ...overrides,
      },
    },
  };
}

/** A policy whose single tool decision is valid except for the one thing under test. */
function toolPolicyWith(tool: unknown): unknown {
  return {
    integrations: {
      github: {
        provider: "composio",
        connection: "github-work",
        tools: { GET_ISSUE: tool },
      },
    },
  };
}

const BROKEN_INTEGRATIONS: Array<[string, unknown]> = [
  ["no provider", policyWith({ provider: undefined })],
  ["an empty provider", policyWith({ provider: "  " })],
  ["a non-string provider", policyWith({ provider: 7 })],
  ["no connection", policyWith({ connection: undefined })],
  ["an empty connection", policyWith({ connection: "" })],
  ["a non-string connection", policyWith({ connection: { slug: "x" } })],
  ["no tools table", policyWith({ tools: undefined })],
  ["a non-object tools table", policyWith({ tools: [] })],
  ["an empty tools table", policyWith({ tools: {} })],
];

const BROKEN_TOOLS: Array<[string, unknown]> = [
  ["no permission", toolPolicyWith({ readOnly: true })],
  ["a null permission", toolPolicyWith({ permission: null, readOnly: true })],
  ["an `inherit` permission", toolPolicyWith({ permission: "inherit" })],
  ["a typo permission", toolPolicyWith({ permission: "Allow" })],
  ["a non-string permission", toolPolicyWith({ permission: 1 })],
  [
    "a non-boolean readOnly",
    toolPolicyWith({ permission: "allow", readOnly: "yes" }),
  ],
  ["a numeric readOnly", toolPolicyWith({ permission: "allow", readOnly: 0 })],
  ["a non-object decision", toolPolicyWith("allow")],
];

describe("an entry that fails intake does not exist anywhere", () => {
  for (const [label, raw] of [...BROKEN_INTEGRATIONS, ...BROKEN_TOOLS]) {
    it(`drops an integration with ${label}, in all four consumers`, () => {
      const policy = normalizeGatewayPolicy(raw);

      // 1. Normalization itself. Keys, not deepEqual: the map has a null prototype by design,
      // so it is not deep-equal to `{}`.
      assert.deepEqual(Object.keys(policy.integrations), []);

      // 2. The run gate: no routing, so nothing to run.
      assert.equal(
        planGatewayRun(
          { integration: "github", tool: "GET_ISSUE", arguments: {} },
          policy,
        ).ok,
        false,
      );

      // 3. Search: not a configured integration, and not a searchable one either.
      assert.equal(
        planGatewaySearch({ query: "an issue", integration: "github" }, policy)
          .ok,
        false,
      );
      assert.equal(planGatewaySearch({ query: "an issue" }, policy).ok, false);

      // 4. The search filter: a result naming it is dropped as unconfigured.
      const outcome = filterGatewaySearchResult(
        JSON.stringify({
          results: [
            {
              integration: "github",
              tool: "GET_ISSUE",
              name: "Get issue",
              input_schema: { type: "object", properties: {} },
            },
          ],
        }),
        policy,
      );
      assert.equal(outcome.kept, 0);

      // 5. The suggestion sanitizer: nothing survives to be suggested.
      const sanitized = sanitizeGatewayRunError(
        JSON.stringify({
          code: "tool_not_found",
          message: "stale",
          details: { suggestions: ["GET_ISSUE"] },
        }),
        "github",
        policy,
      );
      assert.equal(JSON.parse(sanitized).details, undefined);
    });
  }
});

describe("intake keeps what is valid and normalizes what is loose", () => {
  it("keeps a valid entry, trims its routing, and treats absent readOnly as unknown", () => {
    const policy = normalizeGatewayPolicy({
      integrations: {
        github: {
          provider: " composio ",
          connection: " github-work ",
          tools: {
            GET_ISSUE: { permission: "allow", readOnly: true },
            LIST_ISSUES: { permission: "ask" },
            OLD: { permission: "deny", readOnly: null },
          },
        },
      },
    });

    const github = policy.integrations.github;
    assert.equal(github.provider, "composio");
    assert.equal(github.connection, "github-work");
    // Field by field rather than deepEqual: both maps carry a null prototype by design, which
    // is exactly what makes them unequal to an object literal.
    assert.deepEqual(Object.keys(github.tools), [
      "GET_ISSUE",
      "LIST_ISSUES",
      "OLD",
    ]);
    assert.deepEqual(
      { ...github.tools.GET_ISSUE },
      {
        permission: "allow",
        readOnly: true,
      },
    );
    // Absent is unknown, which is a real value on this wire — not `false`.
    assert.deepEqual(
      { ...github.tools.LIST_ISSUES },
      {
        permission: "ask",
        readOnly: null,
      },
    );
    assert.deepEqual(
      { ...github.tools.OLD },
      {
        permission: "deny",
        readOnly: null,
      },
    );
  });

  it("drops only the invalid tools inside an otherwise valid integration", () => {
    const policy = normalizeGatewayPolicy({
      integrations: {
        github: {
          provider: "composio",
          connection: "github-work",
          tools: {
            GET_ISSUE: { permission: "allow", readOnly: true },
            BROKEN: { permission: "maybe" },
          },
        },
      },
    });

    assert.deepEqual(Object.keys(policy.integrations.github.tools), [
      "GET_ISSUE",
    ]);
  });

  it("survives a policy that is not an object at all", () => {
    for (const raw of [
      undefined,
      {},
      { integrations: null },
      { integrations: [] },
    ]) {
      assert.deepEqual(
        Object.keys(normalizeGatewayPolicy(raw).integrations),
        [],
      );
    }
  });

  it("a search filter keeps only allow and ask, never an unexpected value", () => {
    // Normalization already guarantees one of three values; this pins the filter's own shape as
    // an allowlist, so the two guards agree rather than one of them failing open.
    const policy = normalizeGatewayPolicy({
      integrations: {
        github: {
          provider: "composio",
          connection: "github-work",
          tools: {
            READ: { permission: "allow", readOnly: true },
            WRITE: { permission: "ask", readOnly: false },
            GONE: { permission: "deny", readOnly: false },
          },
        },
      },
    });
    const results = ["READ", "WRITE", "GONE"].map((tool) => ({
      integration: "github",
      tool,
      name: tool,
      input_schema: { type: "object", properties: {} },
    }));

    const outcome = filterGatewaySearchResult(
      JSON.stringify({ results }),
      policy,
    );
    assert.deepEqual(outcome.offered, ["github.READ", "github.WRITE"]);
  });
});

/**
 * Every key an object inherits from `Object.prototype` is a name a model can put in
 * `integration` or `tool`. A plain-object lookup answers `map["toString"]` with an inherited
 * FUNCTION, and truthy is all a lookup needs to conclude "configured" — so before the fix,
 * `planGatewayRun("github", "toString")` returned ok with `permission: undefined`, which then
 * fell through to the RUN'S DEFAULT permission and executed under a default of `allow`;
 * `planGatewaySearch(integration: "constructor")` returned ok with a context carrying no
 * provider at all. Measured, not theorized.
 */
const PROTOTYPE_KEYS = [
  "toString",
  "constructor",
  "__proto__",
  "hasOwnProperty",
  "valueOf",
  "isPrototypeOf",
];

describe("an inherited key is not a configured integration", () => {
  const policy = normalizeGatewayPolicy({
    integrations: {
      github: {
        provider: "composio",
        connection: "github-work",
        tools: { GET_ISSUE: { permission: "allow", readOnly: true } },
      },
    },
  });

  for (const key of PROTOTYPE_KEYS) {
    it(`'${key}' as an INTEGRATION is denied, searched against, and filtered out`, () => {
      // The gate. Under a plan default of `allow`, an `ok: true` here would have RUN.
      const run = planGatewayRun(
        { integration: key, tool: "GET_ISSUE", arguments: {} },
        policy,
      );
      assert.equal(run.ok, false, `${key} must not resolve as an integration`);

      // Search, scoped: this is the A6 check, and the one that failed open before.
      const search = planGatewaySearch(
        { query: "x", integration: key },
        policy,
      );
      assert.equal(search.ok, false);

      // The search filter drops a result naming it.
      const outcome = filterGatewaySearchResult(
        JSON.stringify({
          results: [
            {
              integration: key,
              tool: "GET_ISSUE",
              name: "x",
              input_schema: { type: "object", properties: {} },
            },
          ],
        }),
        policy,
      );
      assert.equal(outcome.kept, 0);
      assert.equal(outcome.drops.unconfigured, 1);

      // The suggestion sanitizer holds no decision under it either.
      const sanitized = sanitizeGatewayRunError(
        JSON.stringify({
          code: "tool_not_found",
          message: "stale",
          details: { suggestions: ["GET_ISSUE"] },
        }),
        key,
        policy,
      );
      assert.equal(JSON.parse(sanitized).details, undefined);
    });

    it(`'${key}' as a TOOL key of a real integration is denied`, () => {
      const run = planGatewayRun(
        { integration: "github", tool: key, arguments: {} },
        policy,
      );
      assert.equal(run.ok, false, `github.${key} must not resolve`);

      const outcome = filterGatewaySearchResult(
        JSON.stringify({
          results: [
            {
              integration: "github",
              tool: key,
              name: "x",
              input_schema: { type: "object", properties: {} },
            },
          ],
        }),
        policy,
      );
      assert.equal(outcome.kept, 0);
      assert.equal(outcome.drops.unknownTool, 1);

      const sanitized = sanitizeGatewayRunError(
        JSON.stringify({
          code: "tool_not_found",
          message: "stale",
          details: { suggestions: [key] },
        }),
        "github",
        policy,
      );
      assert.equal(
        JSON.parse(sanitized).details,
        undefined,
        "an inherited key must never be suggested",
      );
    });
  }

  it("an unscoped search never routes on an inherited key", () => {
    // The empty policy has no own keys, so there is no first entry to read a provider from.
    const search = planGatewaySearch({ query: "x" }, EMPTY_POLICY);
    assert.equal(search.ok, false);
  });

  it("a policy that literally declares one of those names still works", () => {
    // The guard is about INHERITANCE, not about the spelling. An author who genuinely names an
    // integration `constructor` must still be able to use it.
    const declared = normalizeGatewayPolicy({
      integrations: {
        constructor: {
          provider: "composio",
          connection: "odd-but-real",
          tools: { toString: { permission: "allow", readOnly: true } },
        },
      },
    });

    const run = planGatewayRun(
      { integration: "constructor", tool: "toString", arguments: {} },
      declared,
    );
    assert.ok(run.ok);
    assert.equal(run.permission, "allow");
    assert.equal(run.context.connection, "odd-but-real");
  });
});

describe("only intake produces a policy a decision will accept", () => {
  it("does not compile when handed a raw wire policy", () => {
    const raw = {
      integrations: {
        github: {
          provider: "composio",
          connection: "github-work",
          tools: {
            GET_ISSUE: { permission: "allow" as const, readOnly: true },
          },
        },
      },
    };

    // The brand, doing the work the structural type could not: this is the whole point of
    // `NormalizedGatewayPolicy` being nominal. `@ts-expect-error` FAILS THE BUILD if the call
    // starts compiling, so deleting the brand breaks `pnpm run typecheck` here.
    // @ts-expect-error a policy that has not been through intake is not a NormalizedGatewayPolicy
    planGatewayRun({ integration: "github", tool: "GET_ISSUE" }, raw);

    // @ts-expect-error the same guard holds for every other decision site
    planGatewaySearch({ query: "x" }, raw);
    // @ts-expect-error ... including the search filter
    filterGatewaySearchResult("{}", raw);
    // @ts-expect-error ... and the suggestion sanitizer
    sanitizeGatewayRunError("{}", "github", raw);

    // The same object, through intake, is accepted.
    assert.ok(
      planGatewayRun(
        { integration: "github", tool: "GET_ISSUE", arguments: {} },
        normalizeGatewayPolicy(raw),
      ).ok,
    );
  });
});

describe("a failed search never returns the API's own words", () => {
  it("replaces a callback failure with the fixed envelope", async () => {
    const relay = await startGatewayRelay();
    stubToolError(
      {
        code: "tool_search_unavailable",
        message:
          "Composio search failed for toolkit 'stripe' on account acct_123.",
        retryable: true,
      },
      "Composio search failed for toolkit 'stripe' on account acct_123.",
    );
    try {
      await forgeRelayRequest(
        relay.dir,
        "search-fail",
        { query: "charge a card" },
        SEARCH_TOOL_SPEC.name,
      );
      const response = await readRelayResponse(relay.dir, "search-fail");

      assert.equal(response.ok, false, "a failed search reads as a failure");
      assert.deepEqual(
        JSON.parse(String(response.error)),
        TOOL_SEARCH_UNAVAILABLE_ERROR,
      );
      for (const leak of ["stripe", "acct_123", "Composio"]) {
        assert.ok(
          !String(response.error).includes(leak),
          `the API's own detail must not reach the model: ${leak}`,
        );
      }
    } finally {
      await relay.stop();
    }
  });

  it("replaces an unparsable success body with the same envelope", async () => {
    const relay = await startGatewayRelay();
    stubToolCall("a proxy error page, not a search result");
    try {
      await forgeRelayRequest(
        relay.dir,
        "search-garbage",
        { query: "an issue" },
        SEARCH_TOOL_SPEC.name,
      );
      const response = await readRelayResponse(relay.dir, "search-garbage");

      assert.equal(response.ok, false);
      assert.deepEqual(
        JSON.parse(String(response.error)),
        TOOL_SEARCH_UNAVAILABLE_ERROR,
        "both search-failure paths answer with exactly one shape",
      );
    } finally {
      await relay.stop();
    }
  });

  it("a failed gateway.run KEEPS its provider detail, sanitized", async () => {
    // The two are deliberately different. A run failure's detail is what lets the model correct
    // a rejected but well-formed request; only its close-key suggestions are filtered.
    const relay = await startGatewayRelay();
    stubToolError(
      {
        code: "tool_execution_failed",
        message: "The provider could not run the tool: 422 title is required.",
        retryable: false,
      },
      "The provider could not run the tool: 422 title is required.",
    );
    try {
      await forgeRelayRequest(relay.dir, "run-fail", {
        integration: "github",
        tool: "GET_ISSUE",
        arguments: { issue: 12 },
      });
      const response = await readRelayResponse(relay.dir, "run-fail");

      assert.equal(response.ok, false);
      assert.ok(String(response.error).includes("422 title is required"));
    } finally {
      await relay.stop();
    }
  });
});
