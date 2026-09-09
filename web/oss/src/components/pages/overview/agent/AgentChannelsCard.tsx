import {useCallback, useEffect, useMemo, useState} from "react"

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

import {buildSlackInstallUrl} from "@/oss/components/pages/settings/Channels/components/SlackHostedAppSection"
import {appsAtom} from "@/oss/state/app"
import {projectIdAtom} from "@/oss/state/project"

/**
 * The agent page's Channels section on desktop: the shared designed screen, wired to the
 * real channels API through `buildAgentChannelsActions`, in an antd Drawer.
 */
const AgentChannelsCard = ({appId, agentName}: {appId: string; agentName?: string}) => {
    const apps = useAtomValue(appsAtom)
    const [connections, setConnections] = useState<ChannelConnections>(EMPTY_CONNECTIONS)
    const [loading, setLoading] = useState(true)

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
                const next = await built.reload()
                setConnections(next)
                return next
            },
        }
    }, [appId, resolveAgentName])

    useEffect(() => {
        let alive = true
        setLoading(true)
        actions
            .reload()
            .catch(() => {
                /* the rows show the last known state; a failed first load reads as empty */
            })
            .finally(() => {
                if (alive) setLoading(false)
            })
        return () => {
            alive = false
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
            actions={actions}
            renderPanel={renderPanel}
        />
    )
}

export default AgentChannelsCard
