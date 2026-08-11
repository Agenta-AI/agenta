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
 * The tool that changes a configuration. BOTH config sentences name it, so both apply only to a
 * run that HAS it.
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
 * The rendered instructions file is a COPY, and the model must not trust it in either direction.
 *
 * TWO OBSERVED FAILURES, ONE WRONG MENTAL MODEL: models treat this file as the source of truth for
 * their configuration.
 *
 *  - WRITING to it. Asked to change its instructions, an agent edits the rendered file and reports
 *    "Done". Nothing is stored. 64 of 117 benchmark failures across claude, pi and codex.
 *  - READING from it. Asked to re-check a value that changed out of band, an agent re-reads the
 *    rendered file and reports the stale value while stating that it checked. 9 of 9 trials, all
 *    three harnesses; one told the user their information was mistaken. The model was not lying.
 *    It checked a copy.
 *
 * The rule for writing is already in `commit_revision`'s tool description, and that is exactly why
 * it does not work: a model that never opens the tool never reads its description. The file is open
 * in front of it, and both using and editing it look exactly like the job.
 *
 * ON THE READ HALF, WHICH IS NOT A BUG THE RUNNER SHOULD FIX. This file is rendered from the
 * REQUEST's parameters (`run-plan.ts`, `agentsMd: request.agentsMd`), so it is a faithful render of
 * the configuration THIS RUN was given. When a request carries changed instructions the file IS
 * re-rendered, which `matrix_l5_live_route_observed.py` proves live. What it cannot show is a
 * change made somewhere else while the run holds the parameters it was opened with. Re-rendering
 * from stored state instead would break running an UNSAVED draft, which is the playground's central
 * interaction. See open-issues, "The rendered instructions file follows the request, not the
 * stored revision".
 *
 * SELF-REFERENTIAL ON PURPOSE. "This file" costs fewer tokens than naming a per-harness path and is
 * accurate on every harness, because this block is rendered INSIDE the file it describes
 * (`CLAUDE.md` on Claude, `AGENTS.md` elsewhere).
 */
export function instructionsSourceAppendix(): SystemPromptAppendix {
  return {
    id: "instructions-source",
    text:
      "This file is a copy of your configuration at " +
      "`parameters.agent.instructions.agents_md`, rendered for this run. Editing it here does " +
      "NOT change your instructions: the edit is overwritten and the user never sees it. It can " +
      "also be out of date: a change made after this run started may not appear here. Use " +
      "read_config for current values, and commit_revision to change them.",
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
      "own skills and use commit_revision as described above.",
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
 * ORDER IS A DECISION, and it was re-made when the instructions sentence arrived. The two config
 * sentences come before the mount paragraph, which is long and describes where things go rather
 * than what to do; a reader who stops early should have read the ones that change an action.
 *
 * INSTRUCTIONS BEFORE SKILLS, on two independent grounds. The benchmark measures editing the
 * rendered instructions file as the DOMINANT failure shape across all three harnesses, well ahead
 * of the skill mistake, so by expected value it is the sentence to read first. And it is
 * self-referential: it describes the document the model is currently reading, so it belongs at the
 * top of that document rather than after a sentence about something else. The earlier rationale
 * ("short and specific") no longer separates them, since both are now short and specific.
 *
 * The ordering itself has NOT been measured. It is cheap to swap and worth testing once the
 * sentence has a baseline.
 *
 * The mount arm is the same three states the Claude channel uses, for the same reason: a folder
 * that WORKED advertises its resolved path; one that was attempted and SKIPPED says so, because
 * the conversation's history may show an earlier session where it worked and only a statement in
 * this turn can contradict it; a run with no durable storage configured says nothing at all.
 */
export function platformGuidanceAppendix(
  input: PlatformGuidanceInput,
): string | undefined {
  // Both config sentences tell the model to use a tool. A run that does not offer that tool would
  // be reading about a capability it does not have, which is the confusion this block exists to
  // remove rather than create. One gate, both sentences, so they can never disagree.
  const hasCommitTool = input.toolNames.includes(CONFIG_COMMIT_TOOL);
  const instructions = hasCommitTool ? instructionsSourceAppendix() : undefined;
  const skills = hasCommitTool ? skillLocationAppendix() : undefined;
  // Gated only on materialized skills, not on the commit tool: the read path is true for any
  // run that has skills, and stating it prevents the guessed-absolute-path failure above.
  const skillsReadPath = input.skillsPath
    ? skillsReadPathAppendix(input.skillsPath)
    : undefined;
  const mount = mountGuidanceServedElsewhere(input)
    ? undefined
    : input.agentMountedPath
      ? agentMountAppendix(input.agentMountedPath)
      : input.agentMountSkipped
        ? agentMountUnavailableAppendix()
        : undefined;
  // Codex only, and placed immediately after the skill sentence it defends, because it is a
  // rebuttal to a specific tool rather than standalone guidance. It costs codex context that the
  // other harnesses do not pay, which is correct: they do not have the problem.
  const codexSkills =
    hasCommitTool && input.acpAgent === "codex"
      ? codexBundledSkillsAppendix()
      : undefined;
  return composeSystemPromptAppendix([
    instructions,
    skills,
    skillsReadPath,
    codexSkills,
    mount,
  ]);
}
