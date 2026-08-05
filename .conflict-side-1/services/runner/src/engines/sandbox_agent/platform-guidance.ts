/**
 * Platform guidance delivered through the AUTHOR'S INSTRUCTIONS FILE.
 *
 * This module owns two things: the contributors that ride this channel, and the rule for which
 * ones ride it on which harness. Composition, ordering, the fence and the spacing live in
 * `system-prompt-appendix.ts`, because they are shared with the system-prompt channels.
 *
 * ============================================================================================
 * WHY THIS CHANNEL EXISTS
 * ============================================================================================
 *
 * The system-prompt channels do not reach every harness. Pi takes an append prompt through its
 * `APPEND_SYSTEM.md` file, Claude takes one through the ACP session's `_meta.systemPrompt.append`,
 * and Codex takes neither: it has no ACP equivalent and `run-plan.ts` gates the append prompt on
 * `isPi`. So a Codex run received no platform guidance at all.
 *
 * Every harness DOES read a rendered instructions file from its working directory, so that file is
 * the one channel common to all three. It is the author's file rather than a system prompt, which
 * is why the text is fenced and why the engine strips the fence out of anything committed. The
 * fence is the price of using this channel; without it the first model that edits its own
 * instructions stores our guidance as the user's configuration.
 *
 * ============================================================================================
 * KEEP IT SHORT
 * ============================================================================================
 *
 * This block is prepended to nothing and appended to everything: it is in the context of every
 * turn, for every agent, on every harness. A small model's attention is the budget being spent
 * here, and it is the same budget the author's own instructions draw on. Every sentence must fix
 * an observed failure. A sentence that only reads well is a sentence taken from the author.
 */

import {
  agentMountAppendix,
  agentMountUnavailableAppendix,
} from "./agent-mount-guidance.ts";
import {
  composeSystemPromptAppendix,
  type SystemPromptAppendix,
} from "./system-prompt-appendix.ts";

/**
 * Where a skill actually lives.
 *
 * THE OBSERVED FAILURE. Asked to save a skill, an agent copied the skill file into the harness's
 * own skills folder inside its working directory and reported success. Nothing was saved: that
 * folder is rendered FROM the configuration on every run, so a file written into it is invisible
 * to the user, absent from the next session, and gone the moment the sandbox is rebuilt. The user
 * then asks for the skill they were told existed and the agent cannot find it.
 *
 * The confusion is reasonable, which is why it needs a sentence rather than a stricter tool: the
 * folder is right there, it is writable, and writing a file into it looks exactly like the job.
 * The fix is to name the one place that counts and to say plainly that the other place does not.
 */
export function skillLocationAppendix(): SystemPromptAppendix {
  return {
    id: "skill-location",
    text:
      "Your skills are part of your configuration, at `parameters.agent.skills`. To add or " +
      "change a skill, edit that configuration with the commit_revision tool. Writing a skill " +
      "file into the skills folder in your working directory does NOT add a skill: that folder " +
      "is rendered from your configuration on every run, so a file you put there is never " +
      "saved and the user cannot see it.",
  };
}

/** What the caller knows about this run's durable agent folder. */
export interface PlatformGuidanceInput {
  /** The harness's ACP agent id: `pi`, `claude` or `codex`. */
  readonly acpAgent: string;
  /** True when this run takes the Pi append-prompt channel. */
  readonly isPi: boolean;
  /** The resolved absolute mount path, when the durable agent folder is live. */
  readonly agentMountedPath: string | undefined;
  /** True when a durable agent folder was ATTEMPTED for this run and refused. */
  readonly agentMountSkipped: boolean;
}

/**
 * Whether the mount guidance already reaches this harness by another channel.
 *
 * THE RULE IS "DO NOT DOUBLE-DELIVER", AND THAT IS WHAT IS ENCODED, rather than the instance
 * "Codex only". Pi gets the mount paragraph through its append prompt (`mount-lifecycle.ts`) and
 * Claude through the session `_meta` (`environment.ts`); saying it twice to either would spend the
 * same context budget the header above is about, and two copies of a paragraph invite a model to
 * look for a difference between them.
 *
 * A harness this function has never heard of falls through to `false` and receives the guidance
 * here. That is the safe direction: the cost of one extra paragraph is context, and the cost of
 * missing it is the model reporting the user's saved work as lost.
 */
function mountGuidanceServedElsewhere(input: PlatformGuidanceInput): boolean {
  return input.isPi || input.acpAgent === "claude";
}

/**
 * The composed guidance for one run, or undefined when there is nothing to say.
 *
 * ORDER IS A DECISION. The skill sentence comes first: it is short, it is specific, and it is the
 * one a model needs before it acts, whereas the mount paragraph is long and describes where things
 * go rather than what to do. A reader who stops early should have read the skill sentence.
 *
 * The mount arm is the same three states the Claude channel uses, for the same reason: a folder
 * that WORKED advertises its resolved path; one that was attempted and SKIPPED says so, because
 * the conversation's history may show an earlier session where it worked and only a statement in
 * this turn can contradict it; a run with no durable storage configured says nothing at all.
 */
export function platformGuidanceAppendix(
  input: PlatformGuidanceInput,
): string | undefined {
  const mount = mountGuidanceServedElsewhere(input)
    ? undefined
    : input.agentMountedPath
      ? agentMountAppendix(input.agentMountedPath)
      : input.agentMountSkipped
        ? agentMountUnavailableAppendix()
        : undefined;
  return composeSystemPromptAppendix([skillLocationAppendix(), mount]);
}
