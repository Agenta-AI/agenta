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
 * The READ side of the skills folder: its real absolute path.
 *
 * THE OBSERVED FAILURE (live session 2026-08-10): asked about its own skills, a model emitted a
 * fully-formed absolute path from pattern memory as its FIRST move — structurally wrong (one id
 * segment where the mount has two) — got ENOENT, and only then listed its real cwd to find the
 * true path, a self-correction that cost a failed call and an approval interruption. Nothing
 * told it where the rendered skills live; the mount paragraph covers only `agent-files/`.
 */
export function skillsReadPathAppendix(
  skillsPath: string,
): SystemPromptAppendix {
  return {
    id: "skills-read-path",
    text:
      `Your rendered skill files live at \`${skillsPath}\` (one folder per skill, each with ` +
      "its SKILL.md). To read a skill, list that directory; never construct the path from memory.",
  };
}

/**
 * The tool that changes a configuration. The codex rebuttal names it, so it applies only to a
 * run that HAS it. The SDK platform text gates its own configuration sections on the same name
 * (`platform_instructions.py`, `CONFIG_COMMIT_TOOL`), so the two layers cannot disagree.
 *
 * It is checked by name here rather than by a flag at the call site, deliberately. The natural
 * guess is the ordered-operations flag, since that is what gates the config-editing surface, but
 * the flag is the wrong axis: `commit_revision` is in `DEFAULT_BUILD_KIT_OPS` unconditionally and
 * the flag changes the commit's DELTA SHAPE rather than the tool's existence, so a flag-off agent
 * with the build kit really can do what the sentence says (its legacy description covers skills by
 * sending the whole list). Presence is the honest test, and it also catches the case a flag check
 * would miss: a flag-ON agent that simply has no config tools.
 */
const CONFIG_COMMIT_TOOL = "commit_revision";

/**
 * The path format the chat file-link resolver can open.
 *
 * THE OBSERVED FAILURES. A model names only `README.md` after working on a nested file, and the
 * client cannot know which file it means (#6004). A model cites an absolute sandbox path, and the
 * client renders it as inert text: the link gate (`chatFileRefs.tsx`) resolves a path RELATIVE to
 * the working directory, with `agent-files/` for the durable folder, and strips only leading and
 * trailing slashes, never a sandbox root. This sentence used to ask for the absolute path, which
 * is the shape that does not open. Verified against the client on 2026-09-07.
 */
export function fileCitationAppendix(): SystemPromptAppendix {
  return {
    id: "file-citations",
    text:
      "When you mention a local file in your response, use a Markdown link whose target is the " +
      "file's path relative to your working directory, with no leading slash: " +
      "`[report.md](agent-files/report.md)` or `[notes.md](drafts/notes.md)`. An absolute path " +
      "does not open, and neither does a bare basename such as `README.md` for a nested file.",
  };
}

/**
 * Codex only: its OWN bundled skills document the wrong workflow, and prose alone loses to them.
 *
 * THE STRUCTURAL PROBLEM, measured. Codex materializes system skills into `CODEX_HOME` at startup,
 * among them `skill-creator` and `skill-installer`, whose SKILL.md files document a procedural
 * workflow for installing skills INTO `.codex/skills` — the exact folder the skill sentence above
 * says does not count. Models follow the documented tool over our prose: 47 path references and 7
 * `init_skill.py` invocations across the failing benchmark trials, with replies like "I'm using the
 * skill-installer workflow to install it into the configured skills location". Codex skill
 * scenarios sit at 6 of 21 while claude and pi, which ship no such skills, produce ZERO
 * wrong_surface on the same scenarios.
 *
 * WHY THIS IS A SENTENCE RATHER THAN A DELETION, WHICH WOULD BE THE REAL FIX. Removing the two
 * skills was investigated and refused as unsafe. They are EMBEDDED IN AND MATERIALIZED BY the codex
 * binary (their files are literals inside it, written out under a version-hash marker), not
 * assembled by the runner, so suppressing them means fighting an undocumented internal mechanism
 * that fails OPEN on any codex upgrade. And `plugin-creator`, a sibling bundled skill, invokes
 * `../skill-creator/scripts/quick_validate.py` by relative path, so removing skill-creator breaks a
 * different bundled asset. See open-issues for the full evidence.
 *
 * HONEST EXPECTATION: this is prose arguing against a documented tool, which is the matchup the
 * benchmark says we lose. It is the strongest lever available without changing what codex ships.
 * If it does not move the number, that is information, and the next lever is upstream.
 */
export function codexBundledSkillsAppendix(): SystemPromptAppendix {
  return {
    id: "codex-bundled-skills",
    text:
      "Your sandbox also has codex's own `skill-creator` and `skill-installer` skills. They " +
      "install into this machine's `.codex/skills` folder, which is NOT your configuration: a " +
      "skill installed that way is not saved and the user cannot see it. Ignore them for your " +
      "own skills; skills live in your configuration and are added with commit_revision.",
  };
}

/** What the caller knows about this run's durable agent folder and its tools. */
export interface PlatformGuidanceInput {
  /** The harness's ACP agent id: `pi`, `claude` or `codex`. */
  readonly acpAgent: string;
  /** True when this run takes the Pi append-prompt channel. */
  readonly isPi: boolean;
  /** The resolved absolute mount path, when the durable agent folder is live. */
  readonly agentMountedPath: string | undefined;
  /** The absolute rendered-skills directory, when this run materialized any skills. */
  readonly skillsPath?: string | undefined;
  /** True when a durable agent folder was ATTEMPTED for this run and refused. */
  readonly agentMountSkipped: boolean;
  /** The names of the tools this run offers the model. */
  readonly toolNames: readonly string[];
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
 * ORDER IS A DECISION. The short, action-changing sentences come first and the mount paragraph,
 * which is long and describes where things go, comes last; a reader who stops early should have
 * read the ones that change an action.
 *
 * WHAT MOVED OUT (2026-09-07). The two config sentences that opened this block, "this file is a
 * copy of your configuration" and "skills live at parameters.agent.skills", now ship once in the
 * SDK platform text (`platform_instructions.py`, "Your configuration"), which every harness reads
 * FIRST. Delivering them here as well would spend the same context twice and invite a model to
 * look for a difference between two wordings of one rule. The benchmark evidence behind them
 * (64 of 117 failures were edits to the rendered file) still stands; it is now the reason that
 * section exists in the SDK text.
 *
 * The mount arm is the same three states the Claude channel uses, for the same reason: a folder
 * that WORKED advertises its resolved path; one that was attempted and SKIPPED says so, because
 * the conversation's history may show an earlier session where it worked and only a statement in
 * this turn can contradict it; a run with no durable storage configured says nothing at all.
 */
export function platformGuidanceAppendix(
  input: PlatformGuidanceInput,
): string | undefined {
  // The two config sentences that used to open this block (the rendered instructions file is a
  // copy; skills live in the configuration) now ship in the SDK platform text, which every
  // harness reads first (`platform_instructions.py`, gated on the same tool name). Only the
  // codex rebuttal still keys on the commit tool here.
  const hasCommitTool = input.toolNames.includes(CONFIG_COMMIT_TOOL);
  // Gated only on materialized skills, not on the commit tool: the read path is true for any
  // run that has skills, and stating it prevents the guessed-absolute-path failure above.
  const skillsReadPath = input.skillsPath
    ? skillsReadPathAppendix(input.skillsPath)
    : undefined;
  const fileCitations = fileCitationAppendix();
  const mount = mountGuidanceServedElsewhere(input)
    ? undefined
    : input.agentMountedPath
      ? agentMountAppendix(input.agentMountedPath)
      : input.agentMountSkipped
        ? agentMountUnavailableAppendix()
        : undefined;
  // Codex only. It is a rebuttal to a specific bundled tool rather than standalone guidance, and
  // it costs codex context that the other harnesses do not pay, which is correct: they do not
  // have the problem.
  const codexSkills =
    hasCommitTool && input.acpAgent === "codex"
      ? codexBundledSkillsAppendix()
      : undefined;
  return composeSystemPromptAppendix([
    skillsReadPath,
    codexSkills,
    fileCitations,
    mount,
  ]);
}
