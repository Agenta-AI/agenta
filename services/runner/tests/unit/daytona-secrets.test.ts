import assert from "node:assert/strict";
import { DaytonaNotFoundError } from "@daytonaio/sdk";
import { describe, it } from "vitest";

import type { DaytonaSecretPlan } from "../../src/engines/sandbox_agent/daytona-secret-plan.ts";
import {
  allocateDaytonaSecrets,
  DAYTONA_SECRETS_PERMISSION_MESSAGE,
  deleteDaytonaSecrets,
  isDaytonaNotFound,
  isDaytonaPermissionDenied,
  type DaytonaSecretApi,
} from "../../src/engines/sandbox_agent/daytona-secrets.ts";

const plan: DaytonaSecretPlan = {
  environment: {},
  candidates: [
    {
      ordinal: 0,
      consumer: { kind: "model" },
      binding: { kind: "environment", name: "ANTHROPIC_API_KEY" },
      allowedHost: "api.anthropic.com",
      value: "model-plain",
    },
    {
      ordinal: 1,
      consumer: { kind: "http_mcp", server: "linear" },
      binding: { kind: "header", name: "Authorization" },
      allowedHost: "mcp.linear.app",
      value: "mcp-plain",
    },
  ],
};

describe("Daytona Secret allocation", () => {
  it("creates exact-host Secrets and returns names plus MCP placeholders", async () => {
    const creates: any[] = [];
    const api: DaytonaSecretApi = {
      async create(input) {
        creates.push(input);
        return {
          id: `id-${creates.length}`,
          name: input.name,
          placeholder: `dtn_secret_${creates.length}`,
          hosts: input.hosts,
        };
      },
      async delete() {},
    };
    const allocation = await allocateDaytonaSecrets(
      plan,
      api,
      (candidate) => `agenta_test_${candidate.ordinal}`,
    );

    assert.deepEqual(
      creates.map(({ name, value, hosts }) => ({ name, value, hosts })),
      [
        {
          name: "agenta_test_0",
          value: "model-plain",
          hosts: ["api.anthropic.com"],
        },
        {
          name: "agenta_test_1",
          value: "mcp-plain",
          hosts: ["mcp.linear.app"],
        },
      ],
    );
    assert.deepEqual(allocation.attachments, {
      ANTHROPIC_API_KEY: "agenta_test_0",
      AGENTA_MCP_SECRET_1: "agenta_test_1",
    });
    assert.deepEqual(allocation.mcpHeaderPlaceholders, {
      linear: { Authorization: "dtn_secret_2" },
    });
  });

  it("compensates created records in reverse order when metadata validation fails", async () => {
    const deletes: string[] = [];
    let count = 0;
    const api: DaytonaSecretApi = {
      async create(input) {
        count += 1;
        return {
          id: `id-${count}`,
          name: input.name,
          placeholder:
            count === 2 ? "plaintext-not-placeholder" : `dtn_secret_${count}`,
          hosts: input.hosts,
        };
      },
      async delete(id) {
        deletes.push(id);
      },
    };

    await assert.rejects(
      () =>
        allocateDaytonaSecrets(
          plan,
          api,
          (candidate) => `agenta_test_${candidate.ordinal}`,
        ),
      /valid opaque Secret placeholder/,
    );
    assert.deepEqual(deletes, ["id-2", "id-1"]);
  });

  it("deletes in reverse order and treats not-found (typed or 404-shaped) as idempotent success", async () => {
    const deletes: string[] = [];
    const api: DaytonaSecretApi = {
      async create() {
        throw new Error("unused");
      },
      async delete(id) {
        deletes.push(id);
        // Both absence shapes the shared predicate recognizes: the SDK's typed error
        // (no statusCode needed) and a bare 404-shaped object.
        if (id === "id-2") throw { statusCode: 404 };
        if (id === "id-1") throw new DaytonaNotFoundError("secret not found");
      },
    };
    await deleteDaytonaSecrets(
      {
        attachments: {},
        mcpHeaderPlaceholders: {},
        created: [
          { id: "id-1", name: "one", placeholder: "dtn_secret_1" },
          { id: "id-2", name: "two", placeholder: "dtn_secret_2" },
        ],
      },
      api,
    );
    assert.deepEqual(deletes, ["id-2", "id-1"]);
  });

  it("shares one not-found predicate across Secret and sandbox cleanup", () => {
    assert.equal(isDaytonaNotFound(new DaytonaNotFoundError("gone")), true);
    assert.equal(isDaytonaNotFound({ statusCode: 404 }), true);
    assert.equal(isDaytonaNotFound({ statusCode: 500 }), false);
    assert.equal(isDaytonaNotFound(new Error("gone")), false);
  });

  it("recognizes a permission refusal by status code or by message", () => {
    assert.equal(isDaytonaPermissionDenied({ statusCode: 403 }), true);
    assert.equal(isDaytonaPermissionDenied({ statusCode: 401 }), true);
    assert.equal(
      isDaytonaPermissionDenied(new Error("Forbidden: missing permission")),
      true,
    );
    // Not a permission problem: a missing record, a server fault, a plain failure.
    assert.equal(isDaytonaPermissionDenied({ statusCode: 404 }), false);
    assert.equal(isDaytonaPermissionDenied({ statusCode: 500 }), false);
    assert.equal(isDaytonaPermissionDenied(new Error("network reset")), false);
    assert.equal(isDaytonaPermissionDenied(undefined), false);
  });

  it("explains an under-permissioned API key instead of surfacing a bare 403", async () => {
    // The whole point: a key that can create sandboxes but not manage Secrets fails EVERY run
    // with a hideable credential, and the raw provider message never mentions the flag that
    // caused it. This is the one failure an operator hits on first enabling the feature.
    const api: DaytonaSecretApi = {
      async create() {
        throw { statusCode: 403, message: "Forbidden" };
      },
      async delete() {},
    };

    await assert.rejects(
      allocateDaytonaSecrets(plan, api),
      (error: Error) => {
        assert.equal(error.message, DAYTONA_SECRETS_PERMISSION_MESSAGE);
        assert.match(error.message, /AGENTA_RUNNER_DAYTONA_API_KEY/);
        assert.match(error.message, /AGENTA_RUNNER_DAYTONA_OPAQUE_SECRETS/);
        // The provider's own error is kept as the cause so the logs still have the detail.
        assert.equal((error.cause as { statusCode: number }).statusCode, 403);
        return true;
      },
    );
  });

  it("leaves a non-permission create failure with its original error", async () => {
    const api: DaytonaSecretApi = {
      async create() {
        throw new Error("daytona is having a bad day");
      },
      async delete() {},
    };
    await assert.rejects(allocateDaytonaSecrets(plan, api), {
      message: "daytona is having a bad day",
    });
  });
});
