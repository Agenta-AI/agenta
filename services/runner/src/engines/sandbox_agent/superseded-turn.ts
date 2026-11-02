/**
 * Frame a user message that follows an unanswered one, so Claude answers the new message.
 *
 * WHY THIS EXISTS. A steer (or a Stop followed by a new message) can end a turn before the model
 * produced any reply. Claude Code then holds two user messages in a row: the stopped request, its
 * own `[Request interrupted by user]` marker, and the new message. It sends them to the model as
 * one user turn, each half led by this turn's session-facts block. The model sees two conflicting
 * instructions, and nothing says which one the user means now. Claude Haiku read the second one as
 * a prompt injection and ignored it, or ran the stopped request again, in 3 of 8 local trials
 * (v0.121.0 release QA). With the note below in front of the new message it answered the new
 * message in every trial.
 *
 * Pi and Codex answered the new message without the note, so it is added for Claude only.
 *
 * The note is decided from the conversation history, not from runner state, so it holds for a warm
 * session, a native session load after a runner restart, and a cold replay alike. A turn that ended
 * after the model replied (text or a tool call) leaves an assistant message between the two user
 * messages, and then no note is added.
 */

import type { ChatMessage } from "../../protocol.ts";

export const SUPERSEDED_TURN_NOTE =
  "[The user's previous message got no reply because that turn ended early. " +
  "The message below is the user's new message and replaces it. Answer the message below. " +
  "Do not resume the earlier request unless the message below asks for it.]";

/** A user message the person typed, not a tool call or tool result carried in the user role. */
function isPlainUserMessage(message: ChatMessage | undefined): boolean {
  if (message?.role !== "user") return false;
  if (!Array.isArray(message.content)) return true;
  return !message.content.some(
    (block) => block?.type === "tool_call" || block?.type === "tool_result",
  );
}

/** True when the message just before the current user message is a user message too. */
export function followsUnansweredUserTurn(
  messages: readonly ChatMessage[] | undefined,
): boolean {
  if (!messages || messages.length < 2) return false;
  return (
    isPlainUserMessage(messages[messages.length - 1]) &&
    isPlainUserMessage(messages[messages.length - 2])
  );
}
