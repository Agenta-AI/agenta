import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it, vi } from "vitest";

import {
  buildPromptBlocks,
  resolveCurrentTurnAttachments,
} from "../../src/engines/sandbox_agent/attachments.ts";
import type { AgentEvent, ChatMessage } from "../../src/protocol.ts";
import { buildPersistingEmitter } from "../../src/sessions/persist.ts";

const IDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
];
const roots: string[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  while (roots.length > 0) {
    rmSync(roots.pop() as string, { recursive: true, force: true });
  }
});

describe("attachment delivery events", () => {
  it("persists one stable outcome per current-turn attachment", async () => {
    const ingested: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/content?")) {
          const id = IDS.find((candidate) => url.includes(candidate));
          return new Response(new Uint8Array([id === IDS[0] ? 1 : 2]), {
            status: 200,
            headers: {
              "content-type": "image/png",
              "content-disposition": `attachment; filename*=UTF-8\x27\x27${id}.png`,
            },
          });
        }
        if (url.endsWith("/sessions/records/ingest")) {
          ingested.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          return new Response("{}", { status: 200 });
        }
        throw new Error("unexpected URL " + url);
      },
    );

    const cwd = mkdtempSync(join(tmpdir(), "agenta-delivery-events-"));
    roots.push(cwd);
    const message: ChatMessage = {
      role: "user",
      content: IDS.map((attachmentId) => ({
        type: "attachment",
        attachmentId,
      })),
    };
    const live: AgentEvent[] = [];
    const persisting = buildPersistingEmitter(
      "session-1",
      () => "ApiKey test",
      (event) => live.push(event),
    );

    const resolved = await resolveCurrentTurnAttachments({
      message,
      sessionId: "session-1",
      auth: () => "ApiKey test",
      sandbox: {},
      plan: {
        cwd,
        isDaytona: false,
        acpAgent: "pi",
        harness: "pi_core",
      },
      capabilities: { images: true },
      modelCapabilities: { inputModalities: ["image"] },
      emit: persisting.emit,
    });
    await persisting.flush();

    assert.equal(resolved.length, 2);
    const events = live.filter(
      (event): event is Extract<AgentEvent, { type: "attachment_delivery" }> =>
        event.type === "attachment_delivery",
    );
    assert.equal(events.length, 2);
    assert.deepEqual(
      events.map((event) => ({
        id: event.attachmentId,
        outcome: event.outcome,
        reason: event.reasonCode,
        path: event.workingPath,
      })),
      IDS.map((id) => ({
        id,
        outcome: "native",
        reason: "native_supported",
        path: `attachments/${id}/${id}.png`,
      })),
    );
    assert.equal(ingested.length, 2);
    assert.ok(
      ingested.every((payload) => payload.record_type === "attachment_delivery"),
    );
    assert.deepEqual(
      ingested.map((payload) => payload.attributes),
      IDS.map((id) => ({
        type: "attachment_delivery",
        attachmentId: id,
        outcome: "native",
        reasonCode: "native_supported",
        workingPath: `attachments/${id}/${id}.png`,
      })),
    );
  });

  it("degrades a mixed current turn while emitting every outcome", async () => {
    vi.stubGlobal(
      "fetch",
      async (input: Parameters<typeof fetch>[0]) => {
        const url = String(input);
        if (url.includes(IDS[0])) {
          return new Response("missing", { status: 404 });
        }
        return new Response(new Uint8Array([2]), {
          status: 200,
          headers: {
            "content-type": "image/png",
            "content-disposition": `attachment; filename*=UTF-8''.png`,
          },
        });
      },
    );
    const cwd = mkdtempSync(join(tmpdir(), "agenta-delivery-events-"));
    roots.push(cwd);
    const events: AgentEvent[] = [];

    const resolved = await resolveCurrentTurnAttachments({
      message: {
        role: "user",
        content: IDS.map((attachmentId) => ({
          type: "attachment",
          attachmentId,
        })),
      },
      sessionId: "session-1",
      auth: () => "ApiKey test",
      sandbox: {},
      plan: {
        cwd,
        isDaytona: false,
        acpAgent: "pi",
        harness: "pi_core",
      },
      capabilities: { images: true },
      modelCapabilities: { inputModalities: ["image"] },
      emit: (event) => events.push(event),
    });
    assert.equal(resolved.length, 2);
    assert.deepEqual(
      events.map((event) =>
        event.type === "attachment_delivery"
          ? [event.attachmentId, event.outcome, event.reasonCode]
          : [],
      ),
      [
        [IDS[0], "failed", "fetch_failed"],
        [IDS[1], "native", "native_supported"],
      ],
    );
    const blocks = buildPromptBlocks("continue", resolved);
    const textBlock = blocks.at(-1);
    assert.match(
      textBlock?.type === "text" ? textBlock.text : "",
      /attached file: attachment - no longer available/,
    );
  });

  it("reports a current-turn filesystem failure as materialize_failed", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(new Uint8Array([2]), {
          status: 200,
          headers: {
            "content-type": "image/png",
            "content-disposition": "attachment; filename=photo.png",
          },
        }),
    );
    const root = mkdtempSync(join(tmpdir(), "agenta-delivery-events-"));
    roots.push(root);
    const cwd = join(root, "not-a-directory");
    writeFileSync(cwd, "occupied");
    const events: AgentEvent[] = [];

    const resolved = await resolveCurrentTurnAttachments({
      message: {
        role: "user",
        content: [{ type: "attachment", attachmentId: IDS[0] }],
      },
      sessionId: "session-1",
      auth: () => "ApiKey test",
      sandbox: {},
      plan: {
        cwd,
        isDaytona: false,
        acpAgent: "pi",
        harness: "pi_core",
      },
      capabilities: { images: true },
      modelCapabilities: { inputModalities: ["image"] },
      emit: (event) => events.push(event),
    });

    assert.equal(resolved[0].gate.outcome, "failed");
    assert.equal(resolved[0].gate.reasonCode, "materialize_failed");
    assert.deepEqual(events, [
      {
        type: "attachment_delivery",
        attachmentId: IDS[0],
        outcome: "failed",
        reasonCode: "materialize_failed",
      },
    ]);
  });
});
