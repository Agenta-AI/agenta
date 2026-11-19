import {useEffect, useRef} from "react"

import {invalidateAgentCommittedRevisionCache} from "@agenta/entities/workflow"
import {requestLatestVersionCheck} from "@agenta/playground/state"
import type {UIMessage} from "ai"

import {takeCommittedAgentIds} from "./builderCommits"

/**
 * When a builder in this conversation saves a new version of an agent, clear that agent's
 * latest-revision caches and ask its open sessions to run the latest-version check (design D7).
 * Each session then adopts the version or offers "Update to vN" by its own rule. No server event.
 * The conversation is mounted per session, so the calls seen here belong to one session.
 */
export const useBuilderCommitChecks = (messages: UIMessage[]) => {
    const seenRef = useRef<Set<string>>(new Set())
    useEffect(() => {
        for (const agentId of takeCommittedAgentIds(messages, seenRef.current)) {
            invalidateAgentCommittedRevisionCache(agentId)
            requestLatestVersionCheck(agentId)
        }
    }, [messages])
}
