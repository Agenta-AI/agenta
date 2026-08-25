import {useCallback, useEffect, useRef, useState} from "react"

import {createEphemeralAppFromTemplate} from "@agenta/entities/workflow"

/**
 * Mint the local-only agent that first run configures BEFORE it exists — the mobile half of the
 * desktop's playground-native onboarding (`useAgentOnboarding`).
 *
 * The ephemeral is a real entry in the workflow molecule, so every entity-id-driven surface (the
 * config pane, the model picker, the tools list) renders against it with no special casing. Only
 * the two queries in `useAgentEntity` cannot resolve a `local-*` id, which is why the first-run
 * screen passes this id in directly instead of letting the session resolve one.
 *
 * Deliberately NO abort-on-cleanup: React strict mode double-invokes effects (setup → cleanup →
 * setup) and the ref guard blocks the second setup, so aborting on the first cleanup would cancel
 * the only mint attempt and leave `entityId` null forever. The mint is client-only and cheap.
 */
export const useEphemeralAgent = (active: boolean) => {
    const [entityId, setEntityId] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const startedRef = useRef(false)

    const mint = useCallback(() => {
        if (startedRef.current) return
        startedRef.current = true
        setError(null)
        void createEphemeralAppFromTemplate({
            type: "agent",
            defaultName: "New agent",
            // Return as soon as the entity is seeded; the schema inspect round-trip resolves in
            // the background and nothing on this surface waits for it.
            deferInspect: true,
        })
            .then((id) => {
                if (!id) throw new Error("mint returned no entity id")
                setEntityId(id)
            })
            .catch(() => {
                // Release the guard so `retry` can re-run. The mint gives up when the signed-in
                // user has not hydrated within its own timeout, which is recoverable — never
                // leave the surface spinning on it.
                startedRef.current = false
                setError("Couldn't set up your agent.")
            })
    }, [])

    useEffect(() => {
        if (!active) return
        mint()
    }, [active, mint])

    return {entityId, error, retry: mint}
}
