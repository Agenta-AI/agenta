import {useEffect, useRef} from "react"

import {detectFileActivity, recordFileActivityAtom} from "@agenta/entities/session"
import type {ToolUIPart, UIMessage} from "ai"
import {useSetAtom} from "jotai"

import {partToolName} from "../assets/toolDisplay"

/**
 * Mid-stream file-activity detector: scans the streaming assistant turn's tool parts and, when a
 * write-ish tool call settles, records a per-session file-activity signal (which also
 * throttle-revalidates the session's drives). Views subscribe to the signal atoms — this hook
 * only PRODUCES signals; it renders nothing.
 *
 * Scans only the LAST message (the one that updates during a turn); each tool call is processed
 * once (`toolCallId` seen-set, reset per session). Runs on every throttled messages commit —
 * cheap: one array walk over the tail message's parts.
 */
export function useFileActivityDetector({
    sessionId,
    messages,
}: {
    sessionId: string
    messages: UIMessage[]
}) {
    const record = useSetAtom(recordFileActivityAtom)
    const seenRef = useRef<Set<string>>(new Set())

    useEffect(() => {
        seenRef.current = new Set()
    }, [sessionId])

    useEffect(() => {
        const last = messages[messages.length - 1]
        if (!last || last.role !== "assistant") return
        for (const part of last.parts) {
            const type = part.type as string
            if (type !== "dynamic-tool" && !type.startsWith("tool-")) continue
            const tool = part as {toolCallId?: string; state?: string; input?: unknown}
            // Only settled, successful calls — the file exists (or is gone) once output landed.
            if (tool.state !== "output-available") continue
            const toolCallId = tool.toolCallId ?? ""
            if (!toolCallId || seenRef.current.has(toolCallId)) continue
            seenRef.current.add(toolCallId)
            const activity = detectFileActivity(partToolName(part as ToolUIPart), tool.input)
            if (activity) record({sessionId, toolCallId, activity})
        }
    }, [messages, sessionId, record])
}
