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

/**
 * The gate answered no, and the caller CANNOT TELL whether the human or the policy decided.
 *
 * WHY A THIRD MESSAGE INSTEAD OF PICKING ONE OF THE TWO ABOVE. The Pi extension gates a call by
 * raising `ctx.ui.confirm`, and a confirm resolves to a BOOLEAN. Every refusal collapses into
 * `false` on that side: a policy deny, a human declining live, a stored decline replayed out of
 * the conversation, and a fail-closed reject all look identical. The ACP reply the runner sends
 * back is `"once" | "always" | "reject"`, with no room to say which, so the extension cannot
 * recover the difference either.
 *
 * Using `declinedByUserText` there would tell the model a human said no when the policy did.
 * Using `deniedByPolicyText` would tell it the tool is unavailable when a human simply declined
 * this one change, and it is the second that was live: that exact string sat on the Pi builtin
 * path, which is what this function replaces. Both are confident claims about WHO decided, and
 * one of them is false in each arm. A message that states only what is known is worth more than a
 * fluent one that is wrong half the time.
 *
 * So this one drops the attribution and keeps everything that is still true: it happened, it is
 * settled, retrying and reshaping will not move it, and the user is the one to talk to next. That
 * last instruction is correct under BOTH arms, which is what makes the message safe to use when
 * the arm is unknown.
 */
export function refusedAtGateText(toolName: string): string {
  return (
    `The '${toolName}' call was refused and did not run. That decision is already made: ` +
    `sending the same call again, or a reshaped version of it, will be refused too. Tell the ` +
    `user this call was refused and ask how they would like to proceed.`
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
