import { describe, expect, it, vi } from "vitest";
import { daytonaWithSecretLease } from "../../src/engines/sandbox_agent/daytona-secret-provider.ts";
describe("lease-aware provider", () => {
  it("attaches names and preserves reconnect/pause forwarding", async () => {
    const events: string[] = []; const runtime = { prepare: async () => ({ lease: {} as any, attachments: { MODEL_KEY: "secret-name" }, mcpHeaderPlaceholders: {} }), activate: async () => { events.push("activate"); }, compensate: vi.fn(), cleanup: vi.fn(), currentMcpHeaderPlaceholders: () => ({}) };
    const provider = daytonaWithSecretLease((attachments) => ({ create: async () => { events.push(JSON.stringify(attachments)); return "sandbox"; }, reconnect: async () => { events.push("reconnect"); }, pause: async () => { events.push("pause"); } } as any), runtime);
    await provider.create(); await (provider.reconnect as any)("sandbox"); await (provider.pause as any)("sandbox");
    expect(events).toEqual(['{"MODEL_KEY":"secret-name"}', "activate", "reconnect", "pause"]);
  });
  it("surfaces activation plus incomplete compensation", async () => {
    const provider = daytonaWithSecretLease(() => ({ create: async () => "sandbox", destroy: async () => { throw new Error("delete-fault"); } }), { prepare: async () => ({ lease: {} as any, attachments: {}, mcpHeaderPlaceholders: {} }), activate: async () => { throw new Error("activation-fault"); }, compensate: async () => { throw new Error("cleanup-fault"); }, cleanup: vi.fn(), currentMcpHeaderPlaceholders: () => ({}) });
    await expect(provider.create()).rejects.toBeInstanceOf(AggregateError);
  });
});
