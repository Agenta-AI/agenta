import {atom} from "jotai"

/**
 * One-shot UI requests from the panel to a session's own row or pane — the seam the keyboard
 * shortcuts use, since the composer's input handle and the tab label's edit mode both live inside
 * per-session components the panel can't reach.
 *
 * Same shape as `simulatedAgentRunAtomFamily`: the nonce makes the same request repeatable, and
 * consumers de-dupe against it with a ref (StrictMode replays the effect). Consumers never clear
 * the slot — the last request just sits there, already consumed.
 */
export interface SessionUiRequest {
    /** The chat scope that issued this — the drawer mounts a second panel over the playground's,
     * and both panels' rows and panes read these atoms. Same discriminator `pendingSessionOpen`
     * carries as `appId`. */
    scope: string
    sessionId: string
    nonce: number
}

/** Does this request address the given session in the given scope? */
export const matchesSessionRequest = (
    request: SessionUiRequest | null,
    scope: string,
    sessionId: string,
): request is SessionUiRequest => request?.scope === scope && request.sessionId === sessionId

/** Put the caret in this session's composer once its pane is mounted. */
export const focusComposerRequestAtom = atom<SessionUiRequest | null>(null)

/** Open the inline rename editor on this session's tab chip / rail row. */
export const renameSessionRequestAtom = atom<SessionUiRequest | null>(null)

/** Put the caret in the rail's session-search box. Carries a nonce only: the rail is per-panel. */
export const sessionSearchRequestAtom = atom<number | null>(null)
