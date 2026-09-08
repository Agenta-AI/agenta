/**
 * Publishes the file-link resolver for the active conversation so the chat's Markdown renderer can
 * turn inline `` `filename` `` spans that name a real drive file into a compact inline file
 * reference (see `state/fileLinks`). Renders nothing; mounted once per conversation.
 *
 * It no longer lists the whole mount tree — the resolver ({@link chatFileResolver}) resolves each
 * mention from the session records (files the agent wrote, free) or a viewport-gated single-file
 * check, never a 12k-path LIST. So this is now a thin bridge: publish the (static) resolver while
 * mounted, clear it on unmount.
 */
import {useEffect} from "react"

import {useAtomValue, useSetAtom} from "jotai"

import {chatFileLinkAtomFamily} from "./chatFileLinks"
import {chatFileResolver} from "./chatFileRefs"
import {useDriveSessionId} from "./driveSessionContext"

export function DriveFileLinkProvider({
    sessionId,
}: {
    sessionId: string
    /** Unused now (the resolver reads the ambient drive context) — kept so the call site is stable. */
    artifactId?: string | null
}) {
    const setLink = useSetAtom(chatFileLinkAtomFamily(sessionId))
    useEffect(() => {
        setLink(chatFileResolver)
        return () => setLink(null)
    }, [setLink])
    return null
}

/**
 * The resolver for THIS conversation, read from the ambient drive context — what a surface hands
 * `ChatMarkdown` as `useLinkResolver` so a file mention becomes a card instead of a dead path.
 */
export const useChatFileLink = () => {
    const sessionId = useDriveSessionId()
    return useAtomValue(chatFileLinkAtomFamily(sessionId ?? ""))
}
