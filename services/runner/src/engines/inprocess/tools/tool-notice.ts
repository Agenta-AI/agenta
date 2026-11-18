/**
 * Adds a runner notice to a tool's answer, after the call ran: the call is what checks the state
 * the notice is about (for example a drive link that a folder blocks, found at the turn's first
 * tool call). A notice is taken only once the call ended, so it reaches the model with this
 * answer, an error answer included.
 */
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

export function withNotice(tool: ToolDefinition<any, any>, take: () => string | undefined): ToolDefinition<any, any> {
  return {
    ...tool,
    execute: async (...args: Parameters<typeof tool.execute>) => {
      let result: Awaited<ReturnType<typeof tool.execute>>;
      try {
        result = await tool.execute(...args);
      } catch (err) {
        const notice = err instanceof Error ? take() : undefined;
        if (notice) (err as Error).message = `${(err as Error).message}\n\n${notice}`;
        throw err;
      }
      const notice = take();
      return notice ? { ...result, content: [...result.content, { type: "text", text: notice }] } : result;
    },
  };
}
