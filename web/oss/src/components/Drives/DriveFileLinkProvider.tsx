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

import {useSetAtom} from "jotai"

import {chatFileLinkAtomFamily} from "@/oss/components/AgentChatSlice/state/fileLinks"

import {chatFileResolver} from "./chatFileRefs"

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
