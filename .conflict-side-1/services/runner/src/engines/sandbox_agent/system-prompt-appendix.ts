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
 *  - Codex: THERE IS NO CHANNEL TODAY. `run-plan.ts` gates the append prompt on `isPi`, and Codex
 *    has no ACP equivalent, so a Codex run receives no appendix at all. That is a real gap and it
 *    is recorded here rather than hidden behind an abstraction that implies three harnesses are
 *    served equally.
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

/** The `_meta.systemPrompt` shape `claude-agent-acp` forwards into the Claude SDK's preset. */
export interface ClaudeSystemPromptMeta {
  systemPrompt: { append: string };
}

/** Claude's delivery shape. Additive to the Claude Code preset, so `CLAUDE.md` loading is
 *  unaffected. */
export function claudeSystemPromptMeta(appendix: string): ClaudeSystemPromptMeta {
  return { systemPrompt: { append: appendix } };
}
