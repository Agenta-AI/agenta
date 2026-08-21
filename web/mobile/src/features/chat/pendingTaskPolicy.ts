/**
 * When the task parked by Home (or a template pick) may leave for the runner.
 *
 * A task typed on Home is stashed and the session is minted around it, so the chat screen — not
 * the composer that took the text — is what sends it. Three things can hold it back, and the
 * order matters:
 *
 * - it was already sent for THIS session (the chat survives a session switch, so the guard holds
 *   the session id, never a bare flag);
 * - the transcript is still hydrating, and a send now would race the fill;
 * - the project vault has not answered yet, so we do not know whether the gate applies;
 * - the project vault holds no provider key, so the run would come back "no usable credential".
 *
 * The third one is the parity rule: desktop parks its first-run seed while the connect-model gate
 * is active and sends it the moment a key lands (`useFirstRunSeed`). Mobile holds the same way, so
 * a first message typed before any key exists is not burned on a run that cannot succeed.
 */
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
    /** The connect-model gate is up (`useAgentModelKeyStatus().gateActive`). */
    modelBlocked: boolean
}

export const canSendPendingTask = ({
    sessionId,
    sentFor,
    hydrating,
    modelKeyLoading,
    modelBlocked,
}: PendingTaskGate): boolean =>
    sentFor !== sessionId && !hydrating && !modelKeyLoading && !modelBlocked
