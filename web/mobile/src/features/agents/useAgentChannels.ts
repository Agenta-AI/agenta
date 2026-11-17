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

/** How many times the first read asks again after a failure, waiting 1, 2 and 4 seconds. */
const FIRST_READ_RETRIES = 3

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
        discord: renameOrNull(connections.discord),
        agentConnections: connections.agentConnections && {
            slack: connections.agentConnections.slack.map(rename),
            telegram: connections.agentConnections.telegram.map(rename),
            whatsapp: connections.agentConnections.whatsapp.map(rename),
            discord: connections.agentConnections.discord.map(rename),
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

    const {actions, read} = useMemo(() => {
        const built = buildAgentChannelsActions({
            client: getChannelsClient(),
            projectId: () => getDefaultStore().get(projectIdAtom),
            appId,
            resolveAgentName: (id) => resolveRef.current(id),
            hostedSlackInstallUrl: buildSlackInstallUrl,
        })
        /** One read into state. `report` false keeps a failure off screen: a retry follows. */
        const read = async (report: boolean) => {
            const seq = ++reloadSeq.current
            try {
                const next = await built.reload()
                if (seq === reloadSeq.current) {
                    setConnections(next)
                    setLoadError(null)
                }
                return next
            } catch (error) {
                if (report && seq === reloadSeq.current) {
                    setLoadError("Could not load Channels. Try again.")
                }
                throw error
            }
        }
        return {actions: {...built, reload: () => read(true)}, read}
    }, [appId])

    useEffect(() => {
        if (!enabled) return
        let alive = true
        setLoading(true)
        // The first read asks again on failure, as the app's queries do: right after the API
        // restarts, the proxy fails the call before the API serves it, and the next try works.
        const readWithRetries = async () => {
            for (let attempt = 0; alive; attempt++) {
                const last = attempt >= FIRST_READ_RETRIES
                // The sequence this attempt's read takes. A later read ("Try again", an action)
                // owns the state from then on, so this loop stops.
                const seq = reloadSeq.current + 1
                try {
                    await read(last)
                    return
                } catch {
                    if (last || seq !== reloadSeq.current) return
                    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt))
                    if (seq !== reloadSeq.current) return
                }
            }
        }
        void readWithRetries().finally(() => {
            if (alive) setLoading(false)
        })
        return () => {
            alive = false
            reloadSeq.current++
        }
    }, [read, enabled])

    // A roster that lands after the read still names the answering agents.
    const named = useMemo(() => withAgentNames(connections, resolve), [connections, resolve])

    return {connections: named, loading, loadError, actions}
}
