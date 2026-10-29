/**
 * A relay gate's id is the stored interaction token, which the API indexes in a btree, so it must
 * stay short even when the provider's tool-call id runs to several KB. That id rides as `toolCallId`.
 *
 * Run: pnpm exec vitest run tests/unit/relay-gate-token.test.ts
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";

import type { ResolvedToolSpec } from "../../src/protocol.ts";
import type {
  ClientToolRelay,
  ClientToolRelayRequest,
} from "../../src/tools/client-tool-relay.ts";
import {
  localRelayHost,
  RELAY_REQ_SUFFIX,
  startToolRelay,
} from "../../src/tools/relay.ts";
import {
  cleanupRelayDirs,
  makeRelayDir,
  RUN_TOOL_SPEC,
  startGatewayRelay,
  until,
} from "../utils/gateway.ts";

const LONG_TOOL_CALL_ID = `call_abc|fc_${"x".repeat(5_000)}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function writeRequest(
  dir: string,
  toolName: string,
  args: unknown,
): Promise<void> {
  await localRelayHost().write(
    `${dir}/long-call${RELAY_REQ_SUFFIX}`,
    JSON.stringify({ toolName, toolCallId: LONG_TOOL_CALL_ID, args }),
  );
}

afterEach(() => cleanupRelayDirs());

describe("a relay gate's token does not depend on the provider's tool-call id", () => {
  it("a gateway approval stores a short token and keeps the full tool-call id", async () => {
    const relay = await startGatewayRelay();
    try {
      await writeRequest(relay.dir, RUN_TOOL_SPEC.name, {
        integration: "github",
        tool: "CREATE_ISSUE",
        arguments: { title: "t" },
      });
      await until(
        () => relay.harness.interactions.length === 1,
        "the approval interaction",
      );

      const [interaction] = relay.harness.interactions;
      assert.match(interaction.token, UUID);
      assert.equal(interaction.toolCallId, LONG_TOOL_CALL_ID);
    } finally {
      await relay.stop();
    }
  });

  it("a client tool gets a short gate id and keeps the full tool-call id", async () => {
    const clientSpec: ResolvedToolSpec = {
      name: "request_connection",
      kind: "client",
      description: "browser-fulfilled",
    };
    const seen: ClientToolRelayRequest[] = [];
    const clientToolRelay: ClientToolRelay = {
      onClientTool: async (request) => {
        seen.push(request);
        return "pendingApproval";
      },
    };
    const dir = makeRelayDir();
    const relay = startToolRelay(
      localRelayHost(),
      dir,
      [clientSpec],
      undefined,
      undefined,
      clientToolRelay,
    );
    try {
      await relay.ready;
      await writeRequest(dir, clientSpec.name, { integration: "slack" });
      await until(() => seen.length === 1, "the client tool request");

      assert.match(seen[0].id, UUID);
      assert.equal(seen[0].toolCallId, LONG_TOOL_CALL_ID);
    } finally {
      await relay.stop();
    }
  });
});
