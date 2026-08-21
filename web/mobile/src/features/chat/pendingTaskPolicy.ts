/**
 * What happens to the task parked by Home (or a template pick) on this render.
 *
 * A task typed on Home is stashed and the session is minted around it, so the chat screen — not
 * the composer that took the text — is what sends it. Four things can hold it back, and the
 * order matters:
 *
 * - it was already sent for THIS session (the chat survives a session switch, so the guard holds
 *   the session id, never a bare flag);
 * - the transcript is still hydrating, and a send now would race the fill;
 * - the project vault has not answered yet, so we do not know whether the gate applies;
 * - the project vault holds no provider key, so the run would come back "no usable credential".
 *
 * The last one is the parity rule: desktop parks its first-run seed while the connect-model gate
 * is active and sends it the moment a key lands (`useFirstRunSeed`). Mobile holds the same way, so
 * a first message typed before any key exists is not burned on a run that cannot succeed.
 *
 * Only the VAULT-UNRESOLVED hold is bounded, and the difference is what the user can see. A hold
 * on an active gate is the feature working: the strip explains it and the composer is disabled, so
 * the user knows the message is waiting and what to do about it. A hold on an unresolved vault is
 * invisible — no strip, a usable composer, and a message that silently never goes. The vault query
 * has no retry cap, so an outage would park a first message forever. After
 * `MODEL_KEY_WAIT_LIMIT_MS` the task is released and the failure is stated instead. Same shape as
 * the desktop's bounded waits (`buildRequestWithinDeadline`, and the build-kit wait in
 * `useFirstRunSeed`): wait for the thing you need, but never without end.
 */
export type PendingTaskDecision =
    /** Keep the task parked; a later render decides again. */
    | "hold"
    /** Send it now. */
    | "send"
    /** Stop waiting: drop the task and tell the user it was not sent. */
    | "abandon"

/** How long the parked task waits for the project vault before it gives up. */
export const MODEL_KEY_WAIT_LIMIT_MS = 10_000

/** Shown when the vault never answered — the desktop's "not sent, try again" wording family. */
export const PENDING_TASK_NOT_SENT_MESSAGE =
    "Couldn't check this project's provider keys — the message was not sent. Please try again."

export interface PendingTaskGate {
    /** The session the chat screen is mounted for. */
    sessionId: string
    /** The session a parked task was already sent for, if any. */
    sentFor: string | null
    /** The engine is still filling the transcript from the record log. */
    hydrating: boolean
    /**
     * The vault query has not resolved (`useAgentModelKeyStatus().loading`). `modelBlocked` is
     * deliberately FALSE while this is true, so the task must wait on this flag instead — on a
     * cold first run hydration can settle first, and the send would go out before the vault
     * says the project is keyless.
     */
    modelKeyLoading: boolean
    /** How long the vault has been unresolved. Only read while `modelKeyLoading` is true. */
    modelKeyWaitedMs: number
    /** The connect-model gate is up (`useAgentModelKeyStatus().gateActive`). */
    modelBlocked: boolean
}

export const pendingTaskDecision = ({
    sessionId,
    sentFor,
    hydrating,
    modelKeyLoading,
    modelKeyWaitedMs,
    modelBlocked,
}: PendingTaskGate): PendingTaskDecision => {
    if (sentFor === sessionId) return "hold"
    if (hydrating) return "hold"
    if (modelKeyLoading) {
        return modelKeyWaitedMs >= MODEL_KEY_WAIT_LIMIT_MS ? "abandon" : "hold"
    }
    // Unbounded on purpose: the strip is up and the composer is disabled, so this hold is visible
    // and the user holds the release (saving a key).
    if (modelBlocked) return "hold"
    return "send"
}
