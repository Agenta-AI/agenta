import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {getChannelsClient} from "@agenta/sdk/resources"
import {
    EMPTY_CONNECTIONS,
    buildAgentChannelsActions,
    type ChannelConnection,
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

/** Names each connection's answering agent from the current roster, keeping shared rows shared. */
const withAgentNames = (
    connections: ChannelConnections,
    resolve: (id: string) => string | null,
): ChannelConnections => {
    const renamed = new Map<ChannelConnection, ChannelConnection>()
    const rename = (connection: ChannelConnection): ChannelConnection => {
        const agent = connection.agent
        if (!agent) return connection
        let next = renamed.get(connection)
        if (!next) {
            next = {...connection, agent: {...agent, name: resolve(agent.id)}}
            renamed.set(connection, next)
        }
        return next
    }
    const renameOrNull = (connection: ChannelConnection | null) =>
        connection ? rename(connection) : null
    return {
        ...connections,
        slack: renameOrNull(connections.slack),
        telegram: renameOrNull(connections.telegram),
        whatsapp: renameOrNull(connections.whatsapp),
        agentConnections: connections.agentConnections && {
            slack: connections.agentConnections.slack.map(rename),
            telegram: connections.agentConnections.telegram.map(rename),
            whatsapp: connections.agentConnections.whatsapp.map(rename),
        },
        allConnections: connections.allConnections?.map(rename),
    }
}

/**
 * An agent's channel connections and the real actions on them, wired to the channels API.
 * Every reload lands in this hook's state, so the entry point and its open panel agree.
 */
export const useAgentChannels = (
    appId: string,
    {
        resolveAgentName,
        enabled = true,
    }: {
        /** Resolve an agent id to its display name; null when the roster does not hold it. */
        resolveAgentName?: (id: string) => string | null
        /** False holds the first read back; `loading` stays true until it runs. */
        enabled?: boolean
    } = {},
) => {
    const [connections, setConnections] = useState<ChannelConnections>(EMPTY_CONNECTIONS)
    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState<string | null>(null)
    // The newest reload owns the state: a slow earlier read must not overwrite it.
    const reloadSeq = useRef(0)

    const resolve = useCallback((id: string) => resolveAgentName?.(id) ?? null, [resolveAgentName])
    // Each agents-list refetch brings a new resolver; a ref keeps it from rebuilding the actions.
    const resolveRef = useRef(resolve)
    resolveRef.current = resolve

    const actions = useMemo(() => {
        const built = buildAgentChannelsActions({
            client: getChannelsClient(),
            projectId: () => getDefaultStore().get(projectIdAtom),
            appId,
            resolveAgentName: (id) => resolveRef.current(id),
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
    }, [appId])

    useEffect(() => {
        if (!enabled) return
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
    }, [actions, enabled])

    // A roster that lands after the read still names the answering agents.
    const named = useMemo(() => withAgentNames(connections, resolve), [connections, resolve])

    return {connections: named, loading, loadError, actions}
}
