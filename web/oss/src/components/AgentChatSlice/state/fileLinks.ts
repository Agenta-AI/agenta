/**
 * Chat file-link bridge: lets the shared Markdown renderer turn an inline `` `code` `` span that
 * names a real drive file into a one-click "open in Quick Look" affordance, WITHOUT coupling the
 * generic renderer to the Drives module. The Drives layer (which knows the active session's
 * listing + the Quick Look opener) publishes a resolver here; Markdown just consumes it.
 *
 * `resolve(text)` returns the drive-relative path to open (or null if the span isn't a known
 * file); `open(path)` opens it. Null atom value → no active drive → code spans render plain.
 */
import {type ReactNode} from "react"

import {atom} from "jotai"

export interface ChatFileLinkResolver {
    /** Map an inline-code string to a drive file path, or null when it names no known file. */
    resolve: (text: string) => string | null
    /** Render the resolved file as the in-thread file CARD (same component as a detected write) —
     * so a filename the agent mentions in prose reads exactly like the artifact cards above it. */
    renderCard: (path: string) => ReactNode
}

export const chatFileLinkAtom = atom<ChatFileLinkResolver | null>(null)
