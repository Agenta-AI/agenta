import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {getChannelsClient} from "@agenta/sdk/resources"
import {
    ChannelsPage,
    EMPTY_CONNECTIONS,
    buildAgentChannelsActions,
    type ChannelConnections,
    type ChannelsPanelRenderProps,
} from "@agenta/settings-ui"
import {Drawer} from "antd"
import {getDefaultStore, useAtomValue} from "jotai"

import {appsAtom} from "@/oss/state/app"
import {buildSlackInstallUrl} from "@/oss/state/channels/api"
import {projectIdAtom} from "@/oss/state/project"

/**
 * The agent page's Channels section on desktop: the shared designed screen, wired to the
 * real channels API through `buildAgentChannelsActions`, in an antd Drawer.
 */
const AgentChannelsCard = ({appId, agentName}: {appId: string; agentName?: string}) => {
    const apps = useAtomValue(appsAtom)
    const [connections, setConnections] = useState<ChannelConnections>(EMPTY_CONNECTIONS)
    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState<string | null>(null)
    // The newest reload owns the state: a slow earlier read must not overwrite it.
    const reloadSeq = useRef(0)

    const resolveAgentName = useCallback(
        (id: string) => apps.find((app) => app.id === id)?.name ?? null,
        [apps],
    )

    const actions = useMemo(() => {
        const built = buildAgentChannelsActions({
            client: getChannelsClient(),
            projectId: () => getDefaultStore().get(projectIdAtom),
            appId,
            resolveAgentName,
            hostedSlackInstallUrl: buildSlackInstallUrl,
        })
        // Every reload lands in this card's state, so the rows and the open panel agree.
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
    }, [appId, resolveAgentName])

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

    const renderPanel = useCallback(
        ({open, title, subtitle, onClose, children}: ChannelsPanelRenderProps) => (
            <Drawer
                open={open}
                title={
                    <div className="flex flex-col">
                        <span>{title}</span>
                        {subtitle ? (
                            <span className="text-xs font-normal text-colorTextSecondary">
                                {subtitle}
                            </span>
                        ) : null}
                    </div>
                }
                onClose={onClose}
                width={460}
                destroyOnClose
            >
                {children}
            </Drawer>
        ),
        [],
    )

    return (
        <ChannelsPage
            agentId={appId}
            agentName={agentName}
            connections={connections}
            loading={loading}
            loadError={loadError}
            onRetry={() => actions.reload().then(() => undefined)}
            actions={actions}
            renderPanel={renderPanel}
        />
    )
}

export default AgentChannelsCard
