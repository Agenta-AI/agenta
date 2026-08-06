/**
 * Chat file-link bridge: lets the shared Markdown renderer turn an inline `` `code` `` span that
 * names a real drive file into a one-click "open in Quick Look" affordance, WITHOUT coupling the
 * generic renderer to the Drives module. The Drives layer (which knows the active session's
 * listing + the Quick Look opener) publishes a resolver here; Markdown just consumes it.
 *
 * `renderCode(text, fallback)` renders the span — a compact inline file reference when it names a
 * real file, else the plain `fallback` code. Resolution lives in the Drives layer (records +
 * on-demand single-file check, never a full listing). Null value → no active drive → spans render
 * plain.
 *
 * Keyed by SESSION ID (not a single slot): antd Tabs keeps every visited session pane mounted at
 * once, so each pane publishes its own resolver. A backgrounded pane's file mentions resolve against
 * ITS session (the rendered element reads the ambient drive context) — not whichever pane's provider
 * happened to write last, which is what made cards vanish or resolve to a foreign file on tab switch.
 */
import {type ReactNode} from "react"

import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

export interface ChatFileLinkResolver {
    /** Render an inline-code span: a compact file link (icon + name, opens Quick Look) when `text`
     * names a real drive file, else `fallback` (the plain code). Resolution may be ASYNC — the
     * Drives provider resolves from the record log (files the agent wrote, free) or a viewport-gated
     * single-file existence check, never a full-tree listing — so the returned element owns both the
     * link and the plain-code fallback. */
    renderCode: (text: string, fallback: ReactNode) => ReactNode
}

export const chatFileLinkAtomFamily = atomFamily((_sessionId: string) =>
    atom<ChatFileLinkResolver | null>(null),
)
