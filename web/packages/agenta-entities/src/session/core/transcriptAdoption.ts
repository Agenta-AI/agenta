/**
 * When a client should replace the transcript it is rendering with the server's durable one.
 *
 * The durable record log is append-only and ordered, so "the server has more RECORDS than my
 * transcript was built from" is an exact test for "the server moved on". Message counts are not:
 * the agent-chat mapper only closes a message on a `done` record and deliberately folds a paused
 * turn into its resume, so a turn that grows in place — tool results landing, an approval
 * round-trip completing — keeps the same message count from start to finish.
 *
 * Issue #5530: a browser that snapshotted a session mid-turn (while another browser drove it) was
 * left with a partial transcript whose message count already matched the finished one. The
 * count-based guard concluded the server was not ahead and kept the partial copy — on every
 * subsequent reload, permanently.
 */
export interface TranscriptAdoptionInput {
    /** Durable records the SERVER transcript was built from. */
    serverRecordCount: number
    /** Messages in the server transcript. */
    serverMessageCount: number
    /** Messages currently rendered locally. */
    localMessageCount: number
    /** Records the rendered transcript was built from; `undefined` = not server-derived. */
    watermark: number | undefined
    /** This client is streaming the turn, so it — not the log — is the authority. */
    busy: boolean
    /**
     * A card ON SCREEN is still awaiting THIS user (#5942).
     *
     * Adopting over a parked card discards whatever they have half-typed into its form. The local
     * copy is authoritative until the interaction row says the card ended, because a card replayed
     * from the durable log carries its harness-wrapped tool name with no `data-render` sibling —
     * so "the client no longer recognises it as waiting" is NOT evidence that it settled.
     *
     * It protects a RENDERED transcript, so it only applies when there is one — see the
     * `localMessageCount` pairing below.
     */
    awaitingUser?: boolean
}

export const shouldAdoptServerTranscript = ({
    serverRecordCount,
    serverMessageCount,
    localMessageCount,
    watermark,
    busy,
    awaitingUser,
}: TranscriptAdoptionInput): boolean => {
    // Nothing to adopt.
    if (serverMessageCount === 0) return false
    // A live local stream outranks the log until it settles.
    if (busy) return false
    // A card still waiting on the user outranks it too — but only a card that EXISTS. The guard
    // preserves a rendered transcript; with nothing rendered there is no half-typed form to
    // protect, and refusing here leaves a cold open (a session this browser never ran, opened
    // from the sessions list or Home's "waiting on you") permanently blank — the pane paints its
    // empty hero over a session the log has turns for, and the pending approval it is telling the
    // user about becomes unreachable. So pair it with `localMessageCount`.
    if (awaitingUser && localMessageCount > 0) return false
    // THE trigger: the log grew past what we render. An absent watermark reads as 0, so a
    // locally-streamed or pre-#5530 cache re-syncs from the server once on its next open.
    if (serverRecordCount <= (watermark ?? 0)) return false
    // Floor, never a trigger: ingest lag can serve a snapshot shorter than what we render, and
    // trading down would drop the tail. Equal length is fine — that is the #5530 case, where the
    // same messages carry far more content.
    if (serverMessageCount < localMessageCount) return false
    return true
}
