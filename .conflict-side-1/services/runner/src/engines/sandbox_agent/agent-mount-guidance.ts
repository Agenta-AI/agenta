/**
 * The durable-agent-mount contributor to the system-prompt appendix.
 *
 * This module owns ONE appendix paragraph and its wording. Composition, ordering and the Claude
 * delivery shape live in `system-prompt-appendix.ts`, because they are not about mounts: other
 * contributors are coming and the mount must not be their owner.
 *
 * Discovery problem: on a natural "remember this for next time" prompt, an agent has no way
 * to know its cwd is throwaway and `agent-files/` (the agent mount linked into the cwd by
 * `agent-mount.ts`) is durable, so it writes to its own session-scoped memory and the note is
 * lost next session. This segment is appended to the harness's SYSTEM PROMPT — never to the
 * author's `CLAUDE.md`/`AGENTS.md` — and only when an agent mount exists for the run.
 *
 * WHY THE PATH IS SPELLED OUT AND THE VARIABLE NAME IS NOT. This segment used to name
 * `$AGENTA_AGENT_MOUNT_DIR` beside the folder. Two failures came out of that one clause.
 *
 * On Daytona the runner NEVER sets that variable: `mount-lifecycle.ts` writes it only for a local
 * run, because Daytona freezes the daemon environment at sandbox creation. So the clause taught
 * the model the name of a variable that expands to the empty string, and `ls "$VAR"` then reads
 * the wrong place or fails.
 *
 * The harness's own file tools take a path literally. Its terminal expands `$VAR` because a shell
 * runs the command; its file reader does not, because no shell is involved. A model that learned
 * the variable therefore succeeds in one tool and fails in the other, for reasons it cannot see.
 *
 * Both go away by naming the resolved absolute path and never the variable.
 *
 * Wired per harness in `sandbox_agent.ts`:
 *  - Pi: combined into `plan.appendSystemPrompt`, rendered via the existing
 *    `APPEND_SYSTEM.md` file channel (`pi-assets.ts`).
 *  - Claude: passed as the ACP session's `_meta.systemPrompt.append`, which
 *    `@agentclientprotocol/claude-agent-acp` forwards into the claude-agent-sdk's
 *    `{ type: "preset", preset: "claude_code", append }` system-prompt option — additive to
 *    the default Claude Code system prompt, so `CLAUDE.md` loading is unaffected.
 */

import type { SystemPromptAppendix } from "./system-prompt-appendix.ts";

export function agentMountGuidance(mountPath: string): string {
  return (
  "You have two storage areas. Your current working directory is scratch for this " +
  "conversation only. Your durable agent folder, `agent-files/` in your working directory " +
  `(absolute path \`${mountPath}\`), persists across all of your sessions. Put throwaway or ` +
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
  "directory, and write the final report into the durable agent folder."
  );
}

/**
 * What the model is told when durable storage was ATTEMPTED for this run and could not be mounted.
 *
 * THIS EXISTS BECAUSE HISTORY OUTLIVES THE MOUNT, AND THAT IS THE HEART OF THE DESIGN. A silent
 * skip is not a neutral absence. The conversation the model is replaying may contain earlier turns
 * from a session where the folder DID mount, where it listed real files and read them. Saying
 * nothing in the current turn leaves that history as the only account of the world, and the model
 * believes it: it goes looking, finds nothing, and reports that the user's saved work is gone.
 * That reads as deletion, which is the worst possible answer and it is one we caused.
 *
 * So the current turn has to contradict its own history out loud. Absence cannot do that. Only a
 * positive statement can.
 *
 * It is deliberately short and it forbids exactly one behavior, searching. It does not apologize,
 * speculate about the cause, or invite the model to retry, because none of that is actionable
 * from inside the sandbox.
 *
 * SCOPE. Emitted only when a mount was attempted and skipped, never on a run with no durable
 * storage configured. A stack whose tunnel is permanently down would otherwise carry this sentence
 * in every prompt forever, which is how a real warning becomes noise a model learns to ignore.
 */
export function agentMountUnavailableGuidance(): string {
  return (
    "The durable agent folder is not available in this sandbox for this turn. Do not search for " +
    "saved files, and do not tell the user that their saved work is missing or was deleted: " +
    "nothing has been lost, this session simply cannot reach the folder. If the conversation so " +
    "far shows you reading or writing files there, that was a previous session with access. If " +
    "the user asks about saved work, say the durable folder is temporarily unreachable in this " +
    "session."
  );
}

/** The mount contributor for a run whose durable folder is live. */
export function agentMountAppendix(mountPath: string): SystemPromptAppendix {
  return { id: "agent-mount", text: agentMountGuidance(mountPath) };
}

/** The mount contributor for a run whose durable folder was attempted and refused. */
export function agentMountUnavailableAppendix(): SystemPromptAppendix {
  return {
    id: "agent-mount-unavailable",
    text: agentMountUnavailableGuidance(),
  };
}
