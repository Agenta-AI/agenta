import {useCallback, useEffect, useState} from "react"

import type {AgentaApi} from "@agentaai/api-client"

import {resolveChannelPolicy} from "../api"

export interface ChannelPolicyResolveState {
    policy: AgentaApi.ChannelEffectivePolicy | null
    isLoading: boolean
    error: unknown
    refresh: () => Promise<void>
}

/**
 * Resolves the effective policy for one (agent, space) pair — the explain
 * panel's data source. Re-resolves on mount and whenever agentId/spaceId
 * change, plus on demand via `refresh` (called after save, never on every
 * keystroke — resolving is a network call against `resolve_channel_policy`).
 */
export const useChannelPolicyResolve = (
    agentId: string | null | undefined,
    spaceId: string | null | undefined,
): ChannelPolicyResolveState => {
    const [policy, setPolicy] = useState<AgentaApi.ChannelEffectivePolicy | null>(null)
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<unknown>(null)

    const refresh = useCallback(async () => {
        if (!agentId || !spaceId) {
            setPolicy(null)
            return
        }
        setIsLoading(true)
        setError(null)
        try {
            const result = await resolveChannelPolicy(agentId, spaceId)
            setPolicy(result.policy ?? null)
        } catch (e) {
            setError(e)
        } finally {
            setIsLoading(false)
        }
    }, [agentId, spaceId])

    useEffect(() => {
        void refresh()
    }, [agentId, spaceId])

    return {policy, isLoading, error, refresh}
}
