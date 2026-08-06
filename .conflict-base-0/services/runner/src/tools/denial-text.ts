/**
 * What the model is told when a call does not run.
 *
 * These strings are read by a model, not by a person, so they are instructions rather than
 * status. QA watched an agent read "denied by the permission policy", treat it as a temporary
 * block, retry the same commit three times with reshaped payloads, drift into unrelated commits,
 * and finally tell the user that writes were "currently blocked" and it would retry "as soon as
 * that is allowed". None of that was true, and every part of it followed from the wording.
 *
 * So each message states three things in order: what happened, that it will not change by
 * retrying, and what to do instead. The last one matters most. A model given no next action
 * invents one.
 *
 * The two cases are kept apart because they are different facts about the world. A human who
 * declines has an opinion about THIS change, and the agent should ask them about it. A policy
 * refusal is about the tool for the whole run, and no conversation with the user unblocks it.
 */

/** The human saw this exact call and said no. */
export function declinedByUserText(toolName: string): string {
  return (
    `The user declined this '${toolName}' call. This is their decision about this specific ` +
    `change, not a temporary block. Do not send this call again, and do not send a reshaped ` +
    `version of it. Ask the user what they would like to do instead.`
  );
}

/** The run's permission policy refuses the tool, whatever its arguments are. */
export function deniedByPolicyText(toolName: string): string {
  return (
    `The tool '${toolName}' is not permitted in this run. This does not change while the ` +
    `conversation continues, and no argument makes it permitted. Do not send this call again. ` +
    `Tell the user the tool is unavailable, and ask what they would like to do instead.`
  );
}
