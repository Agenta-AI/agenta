/**
 * Chat file-link bridge: lets the shared Markdown renderer turn an inline `` `code` `` span that
 * names a real drive file into a one-click "open in Quick Look" affordance, WITHOUT coupling the
 * generic renderer to the Drives module. The Drives layer (which knows the active session's
 * listing + the Quick Look opener) publishes a resolver here; Markdown just consumes it.
 *
 * `resolve(text)` returns the drive-relative path to open (or null if the span isn't a known
 * file); `renderCard(path)` renders the in-thread file card. Null value → no active drive → code
 * spans render plain.
 *
 * Keyed by SESSION ID (not a single slot): antd Tabs keeps every visited session pane mounted at
 * once, so each pane publishes its own resolver against its own drive listing. A backgrounded
 * pane's file mentions resolve against ITS session — not whichever pane's provider happened to
 * write last, which is what made cards vanish or resolve to a foreign file on tab switch.
 */
import {type ReactNode} from "react"

import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

export interface ChatFileLinkResolver {
    /** Map an inline-code string to a drive file path, or null when it names no known file. */
    resolve: (text: string) => string | null
    /** Render the resolved file as the in-thread file CARD (same component as a detected write) —
     * so a filename the agent mentions in prose reads exactly like the artifact cards above it. */
    renderCard: (path: string) => ReactNode
}

export const chatFileLinkAtomFamily = atomFamily((_sessionId: string) =>
    atom<ChatFileLinkResolver | null>(null),
)
