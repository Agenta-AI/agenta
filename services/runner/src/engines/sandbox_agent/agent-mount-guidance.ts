/**
 * Platform system-prompt segment steering an agent to its durable agent mount.
 *
 * Discovery problem: on a natural "remember this for next time" prompt, an agent has no way
 * to know its cwd is throwaway and `agent-files/` (the agent mount linked into the cwd by
 * `agent-mount.ts`) is durable, so it writes to its own session-scoped memory and the note is
 * lost next session. This segment is appended to the harness's SYSTEM PROMPT — never to the
 * author's `CLAUDE.md`/`AGENTS.md` — and only when an agent mount exists for the run.
 *
 * Wired per harness in `sandbox_agent.ts`:
 *  - Pi: combined into `plan.appendSystemPrompt`, rendered via the existing
 *    `APPEND_SYSTEM.md` file channel (`pi-assets.ts`).
 *  - Claude: passed as the ACP session's `_meta.systemPrompt.append`, which
 *    `@agentclientprotocol/claude-agent-acp` forwards into the claude-agent-sdk's
 *    `{ type: "preset", preset: "claude_code", append }` system-prompt option — additive to
 *    the default Claude Code system prompt, so `CLAUDE.md` loading is unaffected.
 */

export const AGENT_MOUNT_SYSTEM_PROMPT_SEGMENT =
  "You have two storage areas. Your current working directory is scratch for this " +
  "conversation only. Your durable agent folder — `agent-files/` in your working directory " +
  "(also `$AGENTA_AGENT_MOUNT_DIR`) — persists across all of your sessions. Put throwaway or " +
  "session-specific work in the working directory; put anything you want to keep, reuse " +
  "later, or share across conversations in the durable agent folder. This includes anything " +
  "you would normally save to your own memory tool or notes file: when someone asks you to " +
  "remember something for next time, or to save a note, write a plain file into the durable " +
  "agent folder — do not use your built-in memory system (files there do not persist between " +
  "sessions for this agent), and do not edit your own agent configuration or instructions to " +
  "store the information. The reverse matters just as much. This conversation started with no " +
  "memory of any previous session, but your durable agent folder might already hold notes " +
  "from one. Before you answer any question shaped like a recall (\"what's our X\", \"what " +
  "did we decide\", \"did I tell you Y\", \"do you remember Z\") — including one where your " +
  "first instinct is that you have no such information — list and check the durable agent " +
  "folder for a relevant file first. Only answer that you don't know after actually checking; " +
  "never assume nothing was saved just because this conversation is new. Example: when you " +
  "research a go-to-market plan, keep your intermediate notes and drafts in the working " +
  "directory, and write the final report into the durable agent folder.";

/** Combine a request-supplied append-system-prompt with the platform segment (Pi). */
export function combineAppendSystemPrompt(
  existing: string | undefined,
  segment: string,
): string {
  return existing ? `${existing}\n\n${segment}` : segment;
}

/** The `_meta.systemPrompt` shape `claude-agent-acp` forwards into the Claude SDK's preset. */
export interface ClaudeSystemPromptMeta {
  systemPrompt: { append: string };
}

export function claudeMountSystemPromptMeta(
  segment: string,
): ClaudeSystemPromptMeta {
  return { systemPrompt: { append: segment } };
}
