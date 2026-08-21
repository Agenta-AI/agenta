/**
 * Where a freshly created agent opens.
 *
 * With a seed message there is a session to open: the id was minted on the device, the session
 * does not exist server-side until its first turn, and the chat screen's engine is what sends it.
 * Without one there is nothing to say yet, so the agent's own overview is the destination.
 *
 * `?agent=` rides along because a session with no turns cannot name its agent from records.
 */
export const agentHandoffPath = ({
    base,
    appId,
    sessionId,
}: {
    /** `/w/:workspace/p/:project` */
    base: string
    appId: string
    /** The minted session id, or null for a blank create. */
    sessionId: string | null
}): string =>
    sessionId ? `${base}/sessions/${sessionId}?agent=${appId}` : `${base}/agents/${appId}`
