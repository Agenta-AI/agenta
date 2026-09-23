import {isLiveForAgent} from "../channels/helpers"
import type {ChannelConnections} from "../channels/types"

import type {PublishMenuItem} from "./PublishMenu"

export interface BuildPublishItemsOptions {
    connections: ChannelConnections
    /** The agent whose page this is; a connection answering as another agent is not live here. */
    agentId?: string
    /** The Channels UI preference. Off hides Slack and Telegram; API stays. */
    channelsEnabled: boolean
    /** Whether the API counts as live. Nothing records API use per agent, so it defaults off. */
    apiLive?: boolean
    /** Disables Slack and Telegram while the connections are loading or failed to load. */
    channelsUnavailable?: boolean
}

/** The Publish menu's items, in order: Slack, Telegram, API. */
export const buildPublishItems = ({
    connections,
    agentId,
    channelsEnabled,
    apiLive = false,
    channelsUnavailable = false,
}: BuildPublishItemsOptions): PublishMenuItem[] => [
    ...(channelsEnabled
        ? ([
              {
                  key: "slack",
                  live: isLiveForAgent(connections.slack, agentId),
                  disabled: channelsUnavailable,
              },
              {
                  key: "telegram",
                  live: isLiveForAgent(connections.telegram, agentId),
                  disabled: channelsUnavailable,
              },
          ] satisfies PublishMenuItem[])
        : []),
    {key: "api", live: apiLive},
]
