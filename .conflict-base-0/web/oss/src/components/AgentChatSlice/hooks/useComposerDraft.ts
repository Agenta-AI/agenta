import {type RefObject, useCallback, useEffect, useRef, useState} from "react"

import {type RichChatInputHandle} from "@agenta/ui/rich-chat-input"

import {composerDraftBySession, isSessionFresh} from "../state/sessionEphemera"

/**
 * The composer's per-session unsent draft and its mount-time entrance flags. Markdown is read off
 * the editor handle at capture time rather than per keystroke — serialization isn't free.
 */
export const useComposerDraft = ({
    sessionId,
    richInputRef,
    revealPlayedRef,
}: {
    sessionId: string
    richInputRef: RefObject<RichChatInputHandle | null>
    /** Shared across the panel's session panes: the composer entrance plays only once. */
    revealPlayedRef: React.MutableRefObject<boolean>
}) => {
    // Composer entrance plays once per PANEL mount — additional session panes mount the
    // composer fully shown (the replayed fade read as a "composer reload" on session switch).
    // Frozen at mount: recomputing per render would flip Reveal's `enabled` mid-entrance
    // (the latch effect below runs before the fade completes).
    const [playComposerEntrance] = useState(() => !revealPlayedRef.current)
    useEffect(() => {
        revealPlayedRef.current = true
    }, [revealPlayedRef])

    // A brand-new session mounts a fresh pane — drop the cursor straight into the composer so the
    // user can type immediately. Frozen at mount (fresh-until-first-send) and driven through the
    // editor's own AutoFocusPlugin, which fires on the lazy Lexical mount rather than racing it.
    const [autoFocusComposer] = useState(() => isSessionFresh(sessionId))

    // Per-session unsent draft: restore once at mount (initialMarkdown is mount-only) and
    // capture edits debounced — markdown is read from the handle at capture time, not per
    // keystroke (serialization isn't free).
    const [initialDraft] = useState(() => composerDraftBySession.get(sessionId))
    const draftTimerRef = useRef(0)
    const handleComposerChange = useCallback(
        (text: string) => {
            window.clearTimeout(draftTimerRef.current)
            draftTimerRef.current = window.setTimeout(() => {
                const md = richInputRef.current?.getMarkdown() ?? text
                if (md.trim()) composerDraftBySession.set(sessionId, md)
                else composerDraftBySession.delete(sessionId)
            }, 400)
        },
        [sessionId],
    )
    useEffect(
        () => () => {
            window.clearTimeout(draftTimerRef.current)
            // Best-effort final capture on unmount (guarded — the editor may be detached).
            const md = richInputRef.current?.getMarkdown()
            if (md !== undefined) {
                if (md.trim()) composerDraftBySession.set(sessionId, md)
                else composerDraftBySession.delete(sessionId)
            }
        },
        [sessionId],
    )

    /** The message left the composer — drop its persisted draft and any pending capture. */
    const clearDraft = useCallback(() => {
        window.clearTimeout(draftTimerRef.current)
        composerDraftBySession.delete(sessionId)
    }, [sessionId])

    return {
        playComposerEntrance,
        autoFocusComposer,
        initialDraft,
        handleComposerChange,
        clearDraft,
    }
}
