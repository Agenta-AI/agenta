/**
 * Answer one approval gate, then start the steer turn a denial carries — and hand the submission
 * outcome back to the caller.
 *
 * The outcome is the whole point of the return value. The dock reads `recoverable` off it to tell
 * "Answer saved, retry needed" from "Answered, waiting for the agent", so a wrapper that answers
 * the gate and returns nothing makes an undeliverable continuation look like a healthy one for as
 * long as the card stays open. Extracted so that contract has a test of its own.
 *
 * A steer note is sent only with a DENIAL, and only after the answer, because resuming a parked
 * gate makes the harness continue the original prompt: a note fused into that resume is
 * subordinated to the original intent. As its own turn it drives the redirect.
 */
import type {ApprovalSubmissionOutcome} from "@agenta/chat/assets"

export type ApprovalAnswerResult = void | ApprovalSubmissionOutcome

export async function answerThenSteer({
    approved,
    message,
    answer,
    steer,
}: {
    approved: boolean
    message?: string
    answer: () => Promise<ApprovalAnswerResult>
    steer: (text: string) => void
}): Promise<ApprovalAnswerResult> {
    const note = message?.trim()
    const outcome = await answer()
    if (!approved && note) steer(note)
    return outcome
}
