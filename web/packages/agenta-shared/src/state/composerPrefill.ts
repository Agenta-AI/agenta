import {atom} from "jotai"

/**
 * Cross-component request to put a starter prompt in the chat composer, so the agent takes
 * over a setup the user began from the config panel ("Create with AI"). Set by the config
 * panel's add menus and consumed by the composer, which writes the text, focuses the input,
 * and clears this back to `null`. `id` makes a repeated pick of the same prompt a new request.
 */
export interface ComposerPrefillRequest {
    id: number
    text: string
}

export const composerPrefillRequestAtom = atom<ComposerPrefillRequest | null>(null)

/**
 * How many mounted composers consume {@link composerPrefillRequestAtom}. The config panel
 * offers "Create with AI" only when this is above zero, so a surface with no composer (an
 * embedded agent drawer, a gallery page) never shows an option that does nothing.
 */
export const composerPrefillTargetsAtom = atom(0)
