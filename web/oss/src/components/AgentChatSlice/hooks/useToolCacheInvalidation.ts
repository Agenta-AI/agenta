import {useEffect, useRef} from "react"

import {
    invalidateTriggerSchedules,
    invalidateTriggerSubscriptions,
} from "@agenta/entities/gatewayTrigger"
import type {UIMessage} from "ai"

import {collectToolCacheEffects} from "../assets/toolCacheEffects"

const INVALIDATORS = {
    "trigger-schedules": invalidateTriggerSchedules,
    "trigger-subscriptions": invalidateTriggerSubscriptions,
} as const

/**
 * Drops the caches a settled tool call staled, so the config panel updates mid-stream instead of
 * on the next reload (#5781). Scans the tail message (the one that updates during a turn); each
 * tool call acts once. The first pass of a session only records its history — otherwise reopening
 * a session would replay it as refetches.
 */
export function useToolCacheInvalidation({
    sessionId,
    messages,
}: {
    sessionId: string
    messages: UIMessage[]
}) {
    const seenRef = useRef<Set<string>>(new Set())
    const seededSessionRef = useRef<string | null>(null)

    useEffect(() => {
        // Nothing to seed from yet — spending the seed here would let async-hydrated history
        // through as if it were live.
        if (messages.length === 0) return
        const seeding = seededSessionRef.current !== sessionId
        if (seeding) {
            seededSessionRef.current = sessionId
            seenRef.current = new Set()
        }
        const last = messages[messages.length - 1]
        if (!last || last.role !== "assistant") return
        const effects = collectToolCacheEffects(last, seenRef.current)
        if (seeding) return
        for (const effect of effects) INVALIDATORS[effect]()
    }, [messages, sessionId])
}
