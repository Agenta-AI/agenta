import {useEffect, useRef} from "react"

import {
    invalidateTriggerSchedules,
    invalidateTriggerSubscriptions,
} from "@agenta/entities/gatewayTrigger"
import {detectFileActivity, recordFileActivityAtom} from "@agenta/entities/session"
import type {UIMessage} from "ai"
import {useSetAtom} from "jotai"

import {takeSettledToolCalls, toolCacheEffect, type ToolCacheEffect} from "../model"

const INVALIDATE: Record<ToolCacheEffect, () => void> = {
    "trigger-schedules": invalidateTriggerSchedules,
    "trigger-subscriptions": invalidateTriggerSubscriptions,
}

/** Applies each settled tool call's client side effects: drive file activity and stale caches. */
export function useSettledToolEffects({
    sessionId,
    messages,
}: {
    sessionId: string
    messages: UIMessage[]
}) {
    const record = useSetAtom(recordFileActivityAtom)
    const seenRef = useRef<Set<string>>(new Set())

    // Not seeded from history: a turn that settled while another session was open must still refresh.
    useEffect(() => {
        seenRef.current = new Set()
    }, [sessionId])

    useEffect(() => {
        const last = messages[messages.length - 1]
        if (!last || last.role !== "assistant") return
        const effects = new Set<ToolCacheEffect>()
        for (const call of takeSettledToolCalls(last, seenRef.current)) {
            const activity = detectFileActivity(call.name, call.input)
            if (activity) record({sessionId, toolCallId: call.toolCallId, activity})
            const effect = toolCacheEffect(call.name)
            if (effect) effects.add(effect)
        }
        for (const effect of effects) INVALIDATE[effect]()
    }, [messages, sessionId, record])
}

/** Old name, kept because the abandoned `web/oss` build still imports it. */
export const useFileActivityDetector = useSettledToolEffects
