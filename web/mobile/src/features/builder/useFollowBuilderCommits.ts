import {useEffect, useRef} from "react"

import {invalidateAgentCommittedRevisionCache} from "@agenta/entities/workflow"
import {requestLatestVersionCheck} from "@agenta/playground/state"
import type {UIMessage} from "ai"

import {takeBuilderCommits} from "./builderCommits"

/**
 * Session follow in this browser (design D7): when a builder saves a new version of an agent, the
 * open sessions of that agent clear its latest-revision caches and run the latest-version check.
 * Each session then adopts the version or offers "Update to vN" by its own rule. No server event.
 */
export const useFollowBuilderCommits = ({
    sessionId,
    messages,
}: {
    sessionId: string
    messages: UIMessage[]
}) => {
    const seenRef = useRef<Set<string>>(new Set())
    useEffect(() => {
        seenRef.current = new Set()
    }, [sessionId])

    useEffect(() => {
        const last = messages[messages.length - 1]
        if (!last || last.role !== "assistant") return
        for (const agentId of takeBuilderCommits(last, seenRef.current)) {
            invalidateAgentCommittedRevisionCache(agentId)
            requestLatestVersionCheck(agentId)
        }
    }, [messages, sessionId])
}
