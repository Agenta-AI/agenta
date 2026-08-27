/**
 * Approval identity and the approval card: qa.md R15 to R21.
 *
 * The identity is the EXISTING `approvedCallKey`, computed from the coarse tool name plus the
 * full outer arguments. Those arguments carry the integration and the tool key, so two
 * integration tools already produce two keys and no new keying scheme is needed — R17 is written
 * to prove that, not to justify one. Inventing a gateway-specific identity would put a second
 * scheme beside the one every other tool uses, and warm-session resume depends on that one.
 *
 * The real new work is R16: a person must approve `github.CREATE_ISSUE` with its arguments,
 * not the word `run_tool`.
 *
 * Run: pnpm exec vitest run tests/unit/gateway-approval-identity.test.ts
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";

import { cancelStaleInteractions } from "../../src/sessions/interactions.ts";
import { approvedCallKey } from "../../src/responder.ts";
import {
  cleanupRelayDirs,
  interactionRequests,
  forgeRelayRequest,
  readRelayResponse,
  startGatewayRelay,
  stubToolCall,
} from "../utils/gateway.ts";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  cleanupRelayDirs();
});

function outerArgs(
  integration: string,
  tool: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  return { integration, tool, arguments: args };
}

describe("what a person is shown (R15, R16)", () => {
  it("R15: the approval interaction carries the integration, the tool key, and safe arguments", async () => {
    const relay = await startGatewayRelay();
    stubToolCall({ ok: true });
    try {
      await forgeRelayRequest(
        relay.dir,
        "ask-1",
        outerArgs("slack", "SEND_MESSAGE", {
          channel: "#general",
          text: "hello",
        }),
      );
      await readRelayResponse(relay.dir, "ask-1");

      const [event] = interactionRequests(relay.harness.events);
      const payload = event.payload as Record<string, any>;
      assert.equal(event.kind, "user_approval");

      // Presentation: the integration and the tool key, for the card to render.
      assert.equal(payload.integration, "slack");
      assert.equal(payload.tool, "SEND_MESSAGE");
      assert.equal(payload.display, "slack.SEND_MESSAGE");

      // Identity: the coarse name and the FULL outer arguments, which the egress persists as
      // the cold-replay key. They carry the integration, the tool key, and the tool's own
      // arguments, so a card loses nothing by reading them.
      assert.equal(payload.toolCall.name, "run_tool");
      assert.equal(payload.toolCall.resolvedName, "run_tool");
      assert.deepEqual(payload.toolCall.input, {
        integration: "slack",
        tool: "SEND_MESSAGE",
        arguments: { channel: "#general", text: "hello" },
      });
      assert.deepEqual(payload.toolCall.rawInput, payload.toolCall.input);

      const [interaction] = relay.harness.interactions;
      assert.equal(interaction.toolName, "run_tool");
      assert.deepEqual(interaction.toolArgs, {
        integration: "slack",
        tool: "SEND_MESSAGE",
        arguments: { channel: "#general", text: "hello" },
      });
    } finally {
      await relay.stop();
    }
  });

  it("R16: the card names the integration tool, never only run_tool", async () => {
    const relay = await startGatewayRelay();
    stubToolCall({ ok: true });
    try {
      await forgeRelayRequest(
        relay.dir,
        "ask-2",
        outerArgs("github", "CREATE_ISSUE", { title: "bug" }),
      );
      await readRelayResponse(relay.dir, "ask-2");

      const payload = interactionRequests(relay.harness.events)[0]
        .payload as Record<string, any>;

      // The semantic action is on the card, in fields no replay path reads.
      assert.equal(payload.display, "github.CREATE_ISSUE");
      assert.equal(payload.toolCall.displayName, "github.CREATE_ISSUE");

      // And it is NOT in any identity-bearing field. `title` and `kind` are included because
      // the egress falls back to them when `resolvedName` and a nested spec's name are absent.
      for (const field of ["name", "resolvedName", "title", "kind"]) {
        assert.notEqual(
          payload.toolCall[field],
          "github.CREATE_ISSUE",
          `'${field}' is read as the persisted identity and must not carry the display`,
        );
      }
      // Nothing under a spec alias either: the egress reads a nested object under any of these
      // as a tool spec and would take its `name`.
      for (const alias of ["spec", "toolSpec", "resolvedTool", "tool"]) {
        const nested = payload.toolCall[alias];
        assert.ok(
          nested === undefined || typeof nested !== "object",
          `'${alias}' would be read as a tool spec and rename the identity`,
        );
      }
    } finally {
      await relay.stop();
    }
  });

  it("N7: no card, and no refusal, carries the connection slug", async () => {
    const relay = await startGatewayRelay();
    stubToolCall({ ok: true });
    try {
      await forgeRelayRequest(
        relay.dir,
        "ask-3",
        outerArgs("github", "CREATE_ISSUE", { title: "bug" }),
      );
      await forgeRelayRequest(
        relay.dir,
        "deny-3",
        outerArgs("github", "DELETE_REPOSITORY", { repo: "agenta" }),
      );
      const refusal = await readRelayResponse(relay.dir, "deny-3");
      await readRelayResponse(relay.dir, "ask-3");

      const rendered = JSON.stringify([
        relay.harness.events,
        relay.harness.interactions,
        refusal,
      ]);
      for (const slug of ["github-work", "slack-main"]) {
        assert.ok(
          !rendered.includes(slug),
          `the connection slug '${slug}' must never reach a model-visible payload`,
        );
      }
    } finally {
      await relay.stop();
    }
  });
});

describe("two calls are two identities (R17, R18)", () => {
  it("R17: two integrations sharing a tool key produce distinct approval identities", async () => {
    const github = approvedCallKey(
      "run_tool",
      outerArgs("github", "GET_ISSUE", { issue: 12 }),
    );
    const slack = approvedCallKey(
      "run_tool",
      outerArgs("slack", "GET_ISSUE", { issue: 12 }),
    );

    assert.ok(github && slack);
    assert.notEqual(
      github,
      slack,
      "the integration is inside the arguments, so the existing key already separates them",
    );
  });

  it("R17: an answer for one integration does not satisfy the other", async () => {
    // `slack.GET_ISSUE` compiles to `ask`; the stored answer is for github's key.
    const githubKey = approvedCallKey(
      "run_tool",
      outerArgs("github", "GET_ISSUE", { issue: 12 }),
    );
    assert.ok(githubKey);
    const relay = await startGatewayRelay({
      storedDecisions: new Map([[githubKey, "allow"]]),
    });
    const calls = stubToolCall({ issue: 12 });
    try {
      await forgeRelayRequest(
        relay.dir,
        "replay-1",
        outerArgs("slack", "GET_ISSUE", { issue: 12 }),
      );
      const response = await readRelayResponse(relay.dir, "replay-1");

      assert.deepEqual(response, { ok: true, paused: true });
      assert.equal(
        calls.bodies.length,
        0,
        "the replayed answer must not run it",
      );
      assert.equal(relay.harness.interactions.length, 1);
    } finally {
      await relay.stop();
    }
  });

  it("R18: the same tool with different arguments produces distinct identities", () => {
    const first = approvedCallKey(
      "run_tool",
      outerArgs("github", "CREATE_ISSUE", { title: "bug" }),
    );
    const second = approvedCallKey(
      "run_tool",
      outerArgs("github", "CREATE_ISSUE", { title: "feature" }),
    );
    const reordered = approvedCallKey("run_tool", {
      arguments: { title: "bug" },
      tool: "CREATE_ISSUE",
      integration: "github",
    });

    assert.notEqual(first, second);
    assert.equal(first, reordered, "key order must not change the identity");
  });
});

describe("what executes is what was checked (R19, R20, R21)", () => {
  it("R19: the checked arguments reach the callback unchanged", async () => {
    const key = approvedCallKey(
      "run_tool",
      outerArgs("github", "CREATE_ISSUE", {
        title: "  spaced  ",
        labels: ["a", "b"],
        nested: { deep: { value: null } },
      }),
    );
    assert.ok(key);
    const relay = await startGatewayRelay({
      storedDecisions: new Map([[key, "allow"]]),
    });
    const calls = stubToolCall({ created: 1 });
    try {
      await forgeRelayRequest(
        relay.dir,
        "run-1",
        outerArgs("github", "CREATE_ISSUE", {
          title: "  spaced  ",
          labels: ["a", "b"],
          nested: { deep: { value: null } },
        }),
      );
      await readRelayResponse(relay.dir, "run-1");

      assert.equal(calls.bodies.length, 1);
      const body = calls.bodies[0];
      assert.deepEqual(body.data.function.arguments, {
        title: "  spaced  ",
        labels: ["a", "b"],
        nested: { deep: { value: null } },
      });
      // The outer envelope is the runner's, not the model's: routing comes from the policy.
      assert.equal(body.data.function.name, "gateway.run");
      assert.deepEqual(body.context, {
        provider: "composio",
        integration: "github",
        connection: "github-work",
        tool: "CREATE_ISSUE",
      });
    } finally {
      await relay.stop();
    }
  });

  it("R20: an approval answer is consumed once; a second identical call re-gates", async () => {
    const key = approvedCallKey(
      "run_tool",
      outerArgs("github", "CREATE_ISSUE", { title: "bug" }),
    );
    assert.ok(key);
    const relay = await startGatewayRelay({
      storedDecisions: new Map([[key, "allow"]]),
    });
    const calls = stubToolCall({ created: 1 });
    try {
      await forgeRelayRequest(
        relay.dir,
        "once-1",
        outerArgs("github", "CREATE_ISSUE", { title: "bug" }),
      );
      const first = await readRelayResponse(relay.dir, "once-1");
      assert.equal(first.ok, true);
      assert.equal(calls.bodies.length, 1);

      await forgeRelayRequest(
        relay.dir,
        "once-2",
        outerArgs("github", "CREATE_ISSUE", { title: "bug" }),
      );
      const second = await readRelayResponse(relay.dir, "once-2");

      assert.deepEqual(second, { ok: true, paused: true });
      assert.equal(calls.bodies.length, 1, "the grant was already spent");
      assert.equal(relay.harness.interactions.length, 1);
    } finally {
      await relay.stop();
    }
  });

  it("R21: an unanswered approval does not run on the next turn, and its row is swept", async () => {
    // The next turn carries no answer for this call, so the gate raises again and the tool
    // does not run.
    const relay = await startGatewayRelay();
    const calls = stubToolCall({ created: 1 });
    try {
      await forgeRelayRequest(
        relay.dir,
        "unanswered-1",
        outerArgs("github", "CREATE_ISSUE", { title: "bug" }),
      );
      const response = await readRelayResponse(relay.dir, "unanswered-1");
      assert.deepEqual(response, { ok: true, paused: true });
      assert.equal(calls.bodies.length, 0);
    } finally {
      await relay.stop();
    }

    // And the turn-start sweep cancels it rather than leaving it pending: only a gate this turn
    // answers in-band is spared, and an unanswered approval is not one.
    const swept: Record<string, any>[] = [];
    process.env.AGENTA_API_INTERNAL_URL = "https://api.example";
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      swept.push({
        url: String(url),
        body: JSON.parse(String(init?.body ?? "{}")),
      });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    try {
      await cancelStaleInteractions(
        "session-1",
        "turn-2",
        undefined,
        () => "Access tok",
      );
      assert.equal(swept.length, 1);
      assert.ok(swept[0].url.endsWith("/sessions/interactions/cancel-stale"));
      assert.equal(swept[0].body.turn_id, "turn-2");
      assert.equal(
        swept[0].body.tokens,
        undefined,
        "an unanswered gateway approval is not spared from the sweep",
      );
    } finally {
      delete process.env.AGENTA_API_INTERNAL_URL;
    }
  });
});
