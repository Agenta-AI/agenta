import {useCallback, useEffect, useRef, useState} from "react"

import {createEphemeralAppFromTemplate, fetchAgTypeSchema} from "@agenta/entities/workflow"

import {queryClient} from "@/lib/queryClient"

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
/** The `x-ag-type-ref` the agent config node carries; see the seeding effect below. */
const AGENT_TEMPLATE_AG_TYPE = "agent-template"

export const useEphemeralAgent = (active: boolean) => {
    const [entityId, setEntityId] = useState<string | null>(null)
    /**
     * Seed the `agent-template` type schema into the cache, under the same key
     * `agTypeSchemaAtomFamily` reads.
     *
     * `parametersSchema` enriches every `x-ag-type-ref` node by merging in that type's schema, and
     * the agent config IS such a ref. Its own query atom sits `pending` forever on this surface —
     * mounted, but no request and no error — so the ref stays a bare stub
     * (`type`, `x-ag-type-ref`, `title`, `description`, `default`) with no properties of its own.
     * The config pane then has no fields to render and shows Advanced alone. The desktop
     * playground never hits this because something there fetches the type first.
     */
    useEffect(() => {
        const key = ["workflows", "schemas", "ag-types", AGENT_TEMPLATE_AG_TYPE]
        if (queryClient.getQueryData(key) !== undefined) return
        void fetchAgTypeSchema(AGENT_TEMPLATE_AG_TYPE)
            .then((schema) => queryClient.setQueryData(key, schema))
            .catch(() => undefined)
    }, [])

    const [error, setError] = useState<string | null>(null)
    const startedRef = useRef(false)

    const mint = useCallback(() => {
        if (startedRef.current) return
        startedRef.current = true
        setError(null)
        void createEphemeralAppFromTemplate({
            type: "agent",
            defaultName: "New agent",
            // NOT `deferInspect`. The config pane is the point of this surface, and its Model,
            // Instructions, Tools and Skills sections are schema-driven — deferring the inspect
            // renders a pane with only Advanced and Triggers in it. The desktop can defer because
            // its onboarding subscribes to the readiness atoms that drive the resolution anyway;
            // nothing here does, so the mint waits for the schema it is about to display.
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
