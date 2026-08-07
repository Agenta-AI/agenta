/**
 * The system-prompt appendix: one ordered composition, many contributors.
 *
 * WHAT AN APPENDIX IS. Text the RUNNER adds to the harness's system prompt, on top of whatever
 * the author wrote. It is platform guidance about how this environment works, never product
 * instructions and never the author's own words. It must not reach the author's `CLAUDE.md` or
 * `AGENTS.md`, because those are the user's files and a commit would carry our text into them.
 *
 * WHY THIS MODULE EXISTS. The composer used to live inside `agent-mount-guidance.ts`, which made
 * the mount the owner of a mechanism that is not about mounts. More contributors are coming: the
 * build kit's guidance, the disambiguation that adding a skill means `parameters.agent.skills` and
 * not the harness's own skill directory, and memory-usage guidance. Each would otherwise reach
 * into the mount module or grow its own combine, and the ORDER they appear in would be an
 * accident of call sites rather than a decision.
 *
 * WHAT THIS OWNS AND WHAT IT DOES NOT. It owns composition and order. It does NOT own delivery,
 * which stays per harness and stays where it already is:
 *
 *  - Pi: the composed text lands on `plan.prompt.appendSystemPrompt` and rides the existing
 *    `APPEND_SYSTEM.md` file channel.
 *  - Claude: it rides the ACP session's `_meta.systemPrompt.append`.
 *  - Codex: NO SYSTEM-PROMPT CHANNEL. `run-plan.ts` gates the append prompt on `isPi`, and Codex
 *    has no ACP equivalent. Codex is served instead by the INSTRUCTIONS FILE channel below.
 *
 * THE INSTRUCTIONS FILE IS THE FOURTH CHANNEL, AND THE ONLY ONE ALL THREE HARNESSES READ. Every
 * harness reads a rendered instructions file from its working directory (`CLAUDE.md` for Claude,
 * `AGENTS.md` for the rest), so a fenced block appended to that file reaches Codex too. It is not
 * a system prompt, and the difference is the reason for the fence: the file is the AUTHOR'S file,
 * the model can read it, and a model that copies it back into `commit_revision` would otherwise
 * store our guidance as the user's own configuration. The engine strips the fenced block from any
 * committed value, so the block must be exactly reproducible. See `PLATFORM_GUIDANCE_START`.
 *
 * ORDER IS A DECISION, NOT AN ACCIDENT. Contributors compose in the order the caller lists them,
 * and the caller lists them in one place. A model reads a long system prompt with the usual
 * recency and primacy effects, so a contributor that contradicts another must be able to be placed
 * deliberately relative to it.
 */

/** One contributor's paragraph, with a stable id so a test can assert the composed set. */
export interface SystemPromptAppendix {
  /** Stable, greppable, and never shown to the model. */
  readonly id: string;
  /** The paragraph. Empty or whitespace-only means the contributor had nothing to say. */
  readonly text: string;
}

/**
 * Compose the contributors into one appendix, in the order given.
 *
 * A contributor may be `undefined` (it did not apply to this run) or carry empty text (it applied
 * and had nothing to add); both are skipped, so a caller can build the list unconditionally and
 * let each contributor decide. Returns `undefined` when nothing contributed, which is what keeps
 * an unused channel silent rather than delivering an empty string.
 */
export function composeSystemPromptAppendix(
  contributors: ReadonlyArray<SystemPromptAppendix | undefined>,
): string | undefined {
  const parts = contributors
    .filter((entry): entry is SystemPromptAppendix => !!entry)
    .map((entry) => entry.text.trim())
    .filter((text) => text.length > 0);
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

/**
 * Put the appendix after the author's own append-prompt.
 *
 * The author's text comes first deliberately: ours is platform guidance about the environment, and
 * it should read as an addition to what the author said rather than as a preamble that frames it.
 */
export function appendToSystemPrompt(
  existing: string | undefined,
  appendix: string,
): string {
  return existing ? `${existing}\n\n${appendix}` : appendix;
}

/**
 * The fence around platform guidance rendered into the author's instructions file.
 *
 * THESE TWO LITERALS ARE A CROSS-LANGUAGE CONTRACT. The engine's
 * `api/oss/src/core/workflows/change_set.py` defines `PLATFORM_GUIDANCE_START` and
 * `PLATFORM_GUIDANCE_END` with the same values and strips every fenced block out of any committed
 * configuration value. Neither side may change a fence alone, so `system-prompt-appendix.test.ts`
 * reads the Python file and asserts the four strings agree.
 *
 * WHY A STRIP RATHER THAN A REFUSAL. A model asked to edit its instructions naturally reads the
 * rendered file and writes it back. That is not a mistake it can be taught out of, and refusing
 * the commit would cost a turn to teach it something it cannot act on. So the engine removes the
 * block silently and warns. Our half of that bargain is to render the block so it is recognizable:
 * the exact fences, and the exact spacing below.
 */
export const PLATFORM_GUIDANCE_START = "<!-- agenta:platform-guidance:start -->";
export const PLATFORM_GUIDANCE_END = "<!-- agenta:platform-guidance:end -->";

/** The fenced block on its own: opener, the composed appendix, closer. No trailing newline. */
export function platformGuidanceBlock(appendix: string): string {
  return `${PLATFORM_GUIDANCE_START}\n${appendix}\n${PLATFORM_GUIDANCE_END}`;
}

/**
 * Put the platform guidance after the author's own instructions.
 *
 * SPACING IS LOAD-BEARING, and this is the one place that decides it: exactly `\n\n` between the
 * author's text and the block, and NO trailing newline after the closer. With that spacing a model
 * that copies the rendered file back produces, after the engine's strip, a value byte-identical to
 * what was stored — so the commit is a clean no-change instead of a revision whose only content is
 * a moved blank line. Any other spacing still strips safely; it just commits noise.
 *
 * Author text first, for the same reason as `appendToSystemPrompt`: ours is platform guidance about
 * the environment and should read as an addition to what the author said.
 *
 * Returns the instructions unchanged when there is no guidance, and the bare block when there are
 * no authored instructions — a run with an empty configuration still needs to be told how its
 * environment works.
 */
export function appendPlatformGuidance(
  instructions: string | undefined,
  appendix: string | undefined,
): string | undefined {
  if (!appendix) return instructions;
  const block = platformGuidanceBlock(appendix);
  return instructions ? `${instructions}\n\n${block}` : block;
}

/** The `_meta.systemPrompt` shape `claude-agent-acp` forwards into the Claude SDK's preset. */
export interface ClaudeSystemPromptMeta {
  systemPrompt: { append: string };
}

/** Claude's delivery shape. Additive to the Claude Code preset, so `CLAUDE.md` loading is
 *  unaffected. */
export function claudeSystemPromptMeta(appendix: string): ClaudeSystemPromptMeta {
  return { systemPrompt: { append: appendix } };
}
