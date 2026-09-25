import {useMemo, useState} from "react"

import type {ChannelConnections, ChannelsActions} from "../channels/types"
import {useChannelPanel, type ChannelsPanelRenderProps} from "../channels/useChannelPanel"

import {AgentApiPanel} from "./AgentApiPanel"
import {buildPublishItems} from "./items"
import {PublishMenu, type PublishTarget} from "./PublishMenu"

export interface AgentPublishProps {
    agentId: string
    agentName?: string
    /** Seeds the description of a new Slack app. */
    agentDescription?: string | null
    projectId: string
    workspaceId?: string | null
    /** The Agenta origin, without `/api`, that the API snippets call. */
    host: string
    /** The project's channel connections and the real actions on them, loaded by the host. */
    connections: ChannelConnections
    loading?: boolean
    loadError?: string | null
    actions: ChannelsActions
    /** Host-provided sliding container for every Publish panel: a drawer on /w, a sheet on /m. */
    renderPanel: (props: ChannelsPanelRenderProps) => React.ReactNode
}

/**
 * The agent header's Publish control, identical on the /w playground and the /m session
 * workspace: the button, its Slack / Telegram / API menu with Set up or Live per row, the
 * "Live in N places" count, the channels' connect and manage panels, and the API panel.
 * Hosts pass only data and the panel container.
 */
export const AgentPublish = ({
    agentId,
    agentName,
    agentDescription,
    projectId,
    workspaceId,
    host,
    connections,
    loading = false,
    loadError = null,
    actions,
    renderPanel,
}: AgentPublishProps) => {
    const [apiOpen, setApiOpen] = useState(false)

    const channelPanel = useChannelPanel({
        agentId,
        agentName,
        agentDescription,
        connections,
        actions,
        renderPanel,
    })

    const items = useMemo(
        () =>
            buildPublishItems({
                connections,
                agentId,
                channelsUnavailable: loading || !!loadError,
            }),
        [connections, agentId, loading, loadError],
    )

    const onSelect = (target: PublishTarget) => {
        if (target === "api") setApiOpen(true)
        else channelPanel.open(target)
    }

    return (
        <>
            <PublishMenu items={items} onSelect={onSelect} />
            {channelPanel.panel}
            {apiOpen
                ? renderPanel({
                      open: true,
                      title: "API",
                      wide: true,
                      onClose: () => setApiOpen(false),
                      children: (
                          <AgentApiPanel
                              agentId={agentId}
                              projectId={projectId}
                              workspaceId={workspaceId}
                              host={host}
                          />
                      ),
                  })
                : null}
        </>
    )
}
