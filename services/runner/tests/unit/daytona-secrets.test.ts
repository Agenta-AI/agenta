import assert from "node:assert/strict";
import { describe, it } from "vitest";

import type { DaytonaSecretPlan } from "../../src/engines/sandbox_agent/daytona-secret-plan.ts";
import {
  allocateDaytonaSecrets,
  deleteDaytonaSecrets,
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

  it("deletes in reverse order and treats 404 as idempotent success", async () => {
    const deletes: string[] = [];
    const api: DaytonaSecretApi = {
      async create() {
        throw new Error("unused");
      },
      async delete(id) {
        deletes.push(id);
        if (id === "id-2") throw { statusCode: 404 };
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
});
