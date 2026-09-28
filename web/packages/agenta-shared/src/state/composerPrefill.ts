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
