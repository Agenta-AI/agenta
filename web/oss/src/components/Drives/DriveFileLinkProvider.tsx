/**
 * Publishes a file-link resolver for the active conversation so the chat's Markdown renderer can
 * turn inline `` `filename` `` spans that name a real drive file into the in-thread file CARD
 * (see `state/fileLinks`). Renders nothing; mounted once per conversation. The resolver matches by
 * exact drive path OR by basename tail, so both `notes/todo.md` and a bare `todo.md` in the
 * agent's reply resolve to the same file.
 */
import {useEffect, useMemo} from "react"

import {useSetAtom} from "jotai"

import {chatFileLinkAtom} from "@/oss/components/AgentChatSlice/state/fileLinks"
import {isSessionFresh} from "@/oss/components/AgentChatSlice/state/sessionEphemera"

import {DriveFileCard} from "./DriveFileCard"
import {useSessionDrive} from "./useSessionDrive"

export function DriveFileLinkProvider({sessionId}: {sessionId: string}) {
    const drive = useSessionDrive(isSessionFresh(sessionId) ? "" : sessionId)
    const setLink = useSetAtom(chatFileLinkAtom)

    // Index the listing once per change: full paths for exact hits, basenames for bare-name hits.
    const {byPath, byName} = useMemo(() => {
        const byPath = new Set<string>()
        const byName = new Map<string, string>()
        for (const f of drive.files) {
            byPath.add(f.path)
            const base = f.path.split("/").pop() ?? f.path
            if (!byName.has(base)) byName.set(base, f.path)
        }
        return {byPath, byName}
    }, [drive.files])

    useEffect(() => {
        if (!byPath.size) {
            setLink(null)
            return
        }
        const resolve = (raw: string): string | null => {
            // Only filename-ish spans (a dot or a slash) — never plain words like `json`.
            const text = raw.trim().replace(/^\.?\/+/, "")
            if (!text || !/[./]/.test(text)) return null
            if (byPath.has(text)) return text
            const base = text.split("/").pop() ?? text
            const hit = byName.get(base)
            // Accept the bare basename, or a path that ends with the file (or vice-versa).
            if (hit && (text === base || hit.endsWith(text) || text.endsWith(hit))) return hit
            return null
        }
        setLink({
            resolve,
            renderCard: (path) => <DriveFileCard path={path} />,
        })
        return () => setLink(null)
    }, [byPath, byName, setLink])

    return null
}
