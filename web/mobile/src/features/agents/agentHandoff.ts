/**
 * Where a freshly created agent opens: its playground — a session, since a session IS the
 * playground here. The id was minted on the device and the session does not exist server-side
 * until its first turn. A seeded create sends that turn from the chat screen's engine; a blank
 * one lands with the configuration showing, so there is something to do with a blank agent
 * (it used to land on the overview, a page about an agent that had nothing on it yet).
 *
 * `?agent=` rides along because a session with no turns cannot name its agent from records.
 */
/**
 * Does this create carry a first turn?
 *
 * Attachments alone count. The composer submits `""` on purpose once staged files have settled
 * (`SendButton`'s force-enabled send), so reading the text alone would drop a picture-only first
 * message on the floor and open the session with nothing to send.
 */
export const isSeededCreate = ({seed, partCount}: {seed: string; partCount: number}): boolean =>
    seed.length > 0 || partCount > 0

export const agentHandoffPath = ({
    base,
    appId,
    sessionId,
}: {
    /** `/w/:workspace/p/:project` */
    base: string
    appId: string
    /** The minted session id. */
    sessionId: string
}): string => `${base}/sessions/${sessionId}?agent=${appId}`
