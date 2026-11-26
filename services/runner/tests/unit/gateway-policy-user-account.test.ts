/**
 * A "user" integration: the run person's own connection, named by the run's credential.
 *
 * The SDK sends `connection: null` and `accountSource: "user"`. Intake keeps the entry, and a
 * planned call carries `account_source: "user"` in its private context and no connection,
 * which is how the tools route reads the run's own claim instead of a project slug.
 *
 * Run: pnpm exec vitest run tests/unit/gateway-policy-user-account.test.ts
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  normalizeGatewayPolicy,
  planGatewayRun,
} from "../../src/tools/gateway-policy.ts";

const tools = { GET_MAX_ITEM_ID: { permission: "allow", readOnly: true } };

describe("a user integration", () => {
  it("is kept and routes by account source, not by slug", () => {
    const policy = normalizeGatewayPolicy({
      integrations: {
        hackernews: {
          provider: "composio",
          connection: null,
          accountSource: "user",
          toolkitVersion: "20250827_00",
          tools,
        },
      },
    });
    const plan = planGatewayRun(
      { integration: "hackernews", tool: "GET_MAX_ITEM_ID", arguments: {} },
      policy,
    );
    assert.ok(plan.ok);
    assert.equal(plan.context.account_source, "user");
    assert.equal("connection" in plan.context, false);
  });

  it("an agent integration keeps its slug and carries no account source", () => {
    const policy = normalizeGatewayPolicy({
      integrations: {
        github: {
          provider: "composio",
          connection: "github-work",
          toolkitVersion: "20250827_00",
          tools,
        },
      },
    });
    const plan = planGatewayRun(
      { integration: "github", tool: "GET_MAX_ITEM_ID", arguments: {} },
      policy,
    );
    assert.ok(plan.ok);
    assert.equal(plan.context.connection, "github-work");
    assert.equal("account_source" in plan.context, false);
  });

  it("an entry with neither a slug nor a user account source is dropped", () => {
    const policy = normalizeGatewayPolicy({
      integrations: {
        github: { provider: "composio", toolkitVersion: "20250827_00", tools },
      },
    });
    assert.deepEqual(Object.keys(policy.integrations), []);
  });
});
