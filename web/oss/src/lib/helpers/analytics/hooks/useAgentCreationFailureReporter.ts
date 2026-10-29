import {useEffect} from "react"

import {setAgentCreationFailureReporter} from "@agenta/entities/workflow/agentCreationTelemetry"
import {useAtomValue} from "jotai"

import {posthogAtom} from "../store/atoms"

/**
 * Bridge the `@agenta/entities` creation-failure seam to PostHog.
 *
 * The package must not depend on posthog-js, so it exposes a reporter slot instead. The slot is
 * filled only once a PostHog client exists, which needs `NEXT_PUBLIC_POSTHOG_API_KEY`: a stock
 * self-host never installs a reporter and the seam stays a no-op.
 */
export const useAgentCreationFailureReporter = () => {
    const posthog = useAtomValue(posthogAtom)

    useEffect(() => {
        if (!posthog) return
        setAgentCreationFailureReporter((payload) => {
            posthog.capture?.("agent_create_failed", payload)
        })
        return () => setAgentCreationFailureReporter(null)
    }, [posthog])
}
