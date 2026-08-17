/**
 * Unit tests for the fill-once session facts the runner proposes on its heartbeat:
 *
 *  - `proposeSessionName` — the first user message's text, trimmed and capped on CODE POINTS,
 *    the only thing that names a session no browser ever renders.
 *  - `buildWorkflowReferenceList` — the flat, `key`-discriminated serialization every stored
 *    reference list uses. A bare `Object.values` of the keyed map drops the family, which is
 *    what left stored turns as three (or one) anonymous uuids.
 *  - the heartbeat body carrying both.
 */
import { describe, it, beforeEach, afterEach, vi } from "vitest";
import assert from "node:assert/strict";

import type { AgentRunRequest } from "../../src/protocol.ts";

const fetchCalls: Array<{ url: string; body: Record<string, unknown> }> = [];

vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
  fetchCalls.push({
    url,
    body: init?.body ? JSON.parse(init.body as string) : {},
  });
  return new Response(
    JSON.stringify({ ok: true, stream: { id: "stream-1" } }),
    {
      status: 200,
    },
  );
});

const { startAliveWatchdog } = await import("../../src/sessions/alive.ts");
const { buildWorkflowReferenceList } =
  await import("../../src/sessions/interactions.ts");
const { proposeSessionName } = await import("../../src/sessions/name.ts");

/** A minimal request carrying only what the proposal reads. */
function requestWith(messages: AgentRunRequest["messages"]): AgentRunRequest {
  return { messages } as AgentRunRequest;
}

beforeEach(() => {
  fetchCalls.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("proposeSessionName", () => {
  it("takes the first user message's text, trimmed", () => {
    const name = proposeSessionName(
      requestWith([{ role: "user", content: "  ship the release  " }]),
    );
    assert.equal(name, "ship the release");
  });

  it("concatenates text parts and ignores non-text ones", () => {
    const name = proposeSessionName(
      requestWith([
        {
          role: "user",
          content: [
            { type: "text", text: "check " },
            { type: "image", data: "AAAA", mimeType: "image/png" },
            { type: "text", text: "this screenshot" },
          ],
        },
      ]),
    );
    assert.equal(name, "check this screenshot");
  });

  it("names the session from the FIRST user message, not the latest turn", () => {
    const name = proposeSessionName(
      requestWith([
        { role: "user", content: "first ask" },
        { role: "assistant", content: "done" },
        { role: "user", content: "second ask" },
      ]),
    );
    assert.equal(name, "first ask");
  });

  it("caps at 60 code points without halving an emoji at the boundary", () => {
    const text = `${"a".repeat(59)}😀b`;
    const name = proposeSessionName(
      requestWith([{ role: "user", content: text }]),
    );
    assert.ok(name);
    assert.equal(Array.from(name).length, 60);
    assert.ok(name.endsWith("😀"), "the emoji was split into a lone surrogate");
  });

  it("is undefined when the turn carries no readable text", () => {
    assert.equal(proposeSessionName(requestWith([])), undefined);
    assert.equal(
      proposeSessionName(requestWith([{ role: "assistant", content: "hi" }])),
      undefined,
    );
    assert.equal(
      proposeSessionName(
        requestWith([
          {
            role: "user",
            content: [
              { type: "image", data: "AAAA", mimeType: "image/png" },
              { type: "text", text: "   " },
            ],
          },
        ]),
      ),
      undefined,
    );
    assert.equal(proposeSessionName({} as AgentRunRequest), undefined);
  });
});

describe("buildWorkflowReferenceList", () => {
  it("discriminates each element by its workflow entity, keeping slug and version", () => {
    const refs = buildWorkflowReferenceList({
      artifact: { id: "wf-1", slug: "my-agent" },
      variant: { id: "var-1", slug: "default" },
      revision: { id: "rev-1", version: "3" },
    });
    assert.deepEqual(refs, [
      { id: "wf-1", slug: "my-agent", key: "workflow" },
      { id: "var-1", slug: "default", key: "workflow_variant" },
      { id: "rev-1", version: "3", key: "workflow_revision" },
    ]);
  });

  it("keeps the key on a partial family — the variant-only headless shape", () => {
    assert.deepEqual(buildWorkflowReferenceList({ variant: { id: "var-1" } }), [
      { id: "var-1", key: "workflow_variant" },
    ]);
  });

  it("is undefined when the run has no workflow identity", () => {
    assert.equal(buildWorkflowReferenceList(undefined), undefined);
    assert.equal(buildWorkflowReferenceList({}), undefined);
  });
});

describe("heartbeat session proposal", () => {
  it("carries name and typed references on the first beat", async () => {
    const watchdog = await startAliveWatchdog(
      "sess-1",
      "turn-1",
      "cred",
      undefined,
      {
        name: "ship the release",
        references: buildWorkflowReferenceList({
          artifact: { id: "wf-1" },
          variant: { id: "var-1" },
        }),
      },
    );

    const beat = fetchCalls.find((c) => c.url.includes("heartbeat"));
    assert.ok(beat);
    assert.equal(beat.body["name"], "ship the release");
    assert.deepEqual(beat.body["references"], [
      { id: "wf-1", key: "workflow" },
      { id: "var-1", key: "workflow_variant" },
    ]);

    await watchdog.release();
  });

  it("repeats the proposal on the turn-end beat — the server fills each field once", async () => {
    const watchdog = await startAliveWatchdog(
      "sess-2",
      "turn-2",
      "cred",
      undefined,
      { name: "ship the release" },
    );
    fetchCalls.length = 0;

    await watchdog.release();

    const beat = fetchCalls.find((c) => c.url.includes("heartbeat"));
    assert.ok(beat);
    assert.equal(beat.body["is_running"], false);
    assert.equal(beat.body["name"], "ship the release");
  });

  it("omits both fields when the run proposes neither", async () => {
    const watchdog = await startAliveWatchdog("sess-3", "turn-3", "cred");

    const beat = fetchCalls.find((c) => c.url.includes("heartbeat"));
    assert.ok(beat);
    assert.ok(!("name" in beat.body), "an empty name must not be sent");
    assert.ok(!("references" in beat.body), "an empty list must not be sent");

    await watchdog.release();
  });
});
