import {atom} from "jotai"

/**
 * Raised when a surface wants to put text INTO the chat composer without sending it —
 * the "Ask the agent" affordance on ask-agent hints ({@link providerKeyAddedSignalAtom}
 * is the same signal pattern). The composer host consumes it: inserts the text at the
 * caret, focuses the editor, and clears the atom. Insert, never send: the user keeps
 * the last word on what goes to the agent.
 *
 * `at` disambiguates two identical prefills in a row; a consumer keys its effect on it.
 */
export interface ComposerPrefillSignal {
    text: string
    at: number
}

export const composerPrefillSignalAtom = atom<ComposerPrefillSignal | null>(null)
