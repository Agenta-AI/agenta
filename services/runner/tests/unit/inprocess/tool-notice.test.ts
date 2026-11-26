import { describe, expect, it } from "vitest";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { withNotice } from "../../../src/engines/inprocess/tools/tool-notice.ts";

const tool = (execute: () => Promise<unknown>) => ({ name: "t", execute }) as unknown as ToolDefinition<any, any>;
const run = (t: ToolDefinition<any, any>) => t.execute("id", {}, undefined, undefined, {} as never);

describe("withNotice", () => {
  it("adds the notice after the answer, takes it only once the call ended, and leaves an answer without one as it is", async () => {
    const order: string[] = [];
    const answer = { content: [{ type: "text", text: "out" }], details: undefined };
    const notices = ["the notice", undefined];
    const wrapped = withNotice(
      tool(async () => (order.push("call"), answer)),
      () => (order.push("take"), notices.shift()),
    );
    expect((await run(wrapped)).content).toEqual([{ type: "text", text: "out" }, { type: "text", text: "the notice" }]);
    expect(await run(wrapped)).toBe(answer);
    expect(order).toEqual(["call", "take", "call", "take"]);
  });

  it("adds the notice to an error answer", async () => {
    const wrapped = withNotice(tool(async () => { throw new Error("failed"); }), () => "the notice");
    await expect(run(wrapped)).rejects.toThrow("failed\n\nthe notice");
  });
});
