import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {getChannelsClient} from "@agenta/sdk/resources"
import {
    EMPTY_CONNECTIONS,
    buildAgentChannelsActions,
    type ChannelConnections,
} from "@agenta/settings-ui"
import {projectIdAtom} from "@agenta/shared/state"
import {getDefaultStore} from "jotai"

import {getApiUrl} from "@/lib/env"

/** The hosted Slack install URL — a browser redirect into Slack's OAuth, same route the
 * desktop host builds. `getApiUrl()` is the host `_app` pins the SDK to, so both agree. */
const buildSlackInstallUrl = (projectId: string): string => {
    const params = new URLSearchParams({project_id: projectId})
    return `${getApiUrl()}/channels/catalog/channels/slack/install/?${params.toString()}`
}

/**
 * An agent's channel connections and the real actions on them, wired to the channels API.
 * Every reload lands in this hook's state, so the entry point and its open panel agree.
 */
export const useAgentChannels = (
    appId: string,
    {
        resolveAgentName,
    }: {
        /** Resolve an agent id to its display name; null when the roster does not hold it. */
        resolveAgentName?: (id: string) => string | null
    } = {},
) => {
    const [connections, setConnections] = useState<ChannelConnections>(EMPTY_CONNECTIONS)
    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState<string | null>(null)
    // The newest reload owns the state: a slow earlier read must not overwrite it.
    const reloadSeq = useRef(0)

    const resolve = useCallback((id: string) => resolveAgentName?.(id) ?? null, [resolveAgentName])

    const actions = useMemo(() => {
        const built = buildAgentChannelsActions({
            client: getChannelsClient(),
            projectId: () => getDefaultStore().get(projectIdAtom),
            appId,
            resolveAgentName: resolve,
            hostedSlackInstallUrl: buildSlackInstallUrl,
        })
        return {
            ...built,
            reload: async () => {
                const seq = ++reloadSeq.current
                try {
                    const next = await built.reload()
                    if (seq === reloadSeq.current) {
                        setConnections(next)
                        setLoadError(null)
                    }
                    return next
                } catch (error) {
                    if (seq === reloadSeq.current) {
                        setLoadError("Could not load Channels. Try again.")
                    }
                    throw error
                }
            },
        }
    }, [appId, resolve])

    useEffect(() => {
        let alive = true
        setLoading(true)
        actions
            .reload()
            .catch(() => undefined)
            .finally(() => {
                if (alive) setLoading(false)
            })
        return () => {
            alive = false
            reloadSeq.current++
        }
    }, [actions])

    return {connections, loading, loadError, actions}
}
