import {atom} from "jotai"

/**
 * Cross-component request to put a starter prompt in the chat composer, so the agent takes
 * over a setup the user began from the config panel ("Create with AI"). Set by the config
 * panel's add menus and consumed by the composer, which writes the text, focuses the input,
 * and clears this back to `null` once the text has landed. `id` makes a repeated pick of the
 * same prompt a new request.
 */
export interface ComposerPrefillRequest {
    id: number
    text: string
}

export const composerPrefillRequestAtom = atom<ComposerPrefillRequest | null>(null)

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
