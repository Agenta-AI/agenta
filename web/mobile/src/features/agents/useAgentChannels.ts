import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {createT} from "@agenta/i18n"
import channelsReloadErrorCatalog from "@agenta/i18n/catalogs/channels.reloadError"
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

const tNow = createT(channelsReloadErrorCatalog)

/** The hosted Slack install URL — a browser redirect into Slack's OAuth, same route the
 * desktop host builds. `getApiUrl()` is the host `_app` pins the SDK to, so both agree. */
const buildSlackInstallUrl = (projectId: string): string => {
    const params = new URLSearchParams({project_id: projectId})
    return `${getApiUrl()}/channels/catalog/channels/slack/install/?${params.toString()}`
}

/** The waits between tries of the first read, about a minute in all: an API restart takes ~35 s. */
const FIRST_READ_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000]

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
    // Reads that show the loading state. It stays on until the last of them ends.
    const loadingReads = useRef(0)
    const startLoading = useCallback(() => {
        loadingReads.current++
        setLoading(true)
    }, [])
    const endLoading = useCallback(() => {
        loadingReads.current--
        if (loadingReads.current === 0) setLoading(false)
    }, [])

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
                    setLoadError(tNow("channels.reloadError.loadFailed"))
                }
                throw error
            }
        }
        return {actions: {...built, reload: () => read(true)}, read}
    }, [appId])

    useEffect(() => {
        if (!enabled) return
        let alive = true
        startLoading()
        // The first read asks again on failure: right after the API restarts, the proxy fails
        // the call until the API serves again, and a later try works.
        const readWithRetries = async () => {
            for (let attempt = 0; alive; attempt++) {
                const last = attempt >= FIRST_READ_RETRY_DELAYS_MS.length
                // The sequence this attempt's read takes. A later read ("Try again", an action,
                // opening the panel) owns the state from then on, so this loop stops.
                const seq = reloadSeq.current + 1
                try {
                    await read(last)
                    return
                } catch {
                    if (last || seq !== reloadSeq.current) return
                    await new Promise((resolve) =>
                        setTimeout(resolve, FIRST_READ_RETRY_DELAYS_MS[attempt]),
                    )
                    if (seq !== reloadSeq.current) return
                }
            }
        }
        void readWithRetries().finally(endLoading)
        return () => {
            alive = false
            reloadSeq.current++
        }
    }, [read, enabled, startLoading, endLoading])

    /** Reads again, with the loading state, when the last read failed. Opening the panel calls
     * it, so a panel opened after the API came back shows the connections, not the old error. */
    const readAgainIfFailed = useCallback(() => {
        if (!loadError) return
        setLoadError(null)
        startLoading()
        void read(true)
            .catch(() => null)
            .finally(endLoading)
    }, [loadError, read, startLoading, endLoading])

    // A roster that lands after the read still names the answering agents.
    const named = useMemo(() => withAgentNames(connections, resolve), [connections, resolve])

    return {connections: named, loading, loadError, actions, readAgainIfFailed}
}
