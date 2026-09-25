import {isLiveForAgent} from "../channels/helpers"
import type {ChannelConnections} from "../channels/types"

import type {PublishMenuItem} from "./PublishMenu"

export interface BuildPublishItemsOptions {
    connections: ChannelConnections
    /**
     * The agent whose page this is; a connection answering as another agent is not live here.
     * A saved agent (not a local draft) always has this id, and that alone is what makes the
     * API live: it can always be called once the agent has a saved revision.
     */
    agentId?: string
    /**
     * Whether the API counts as live. Defaults to whether the agent has been saved (has an
     * `agentId`); pass explicitly to override, e.g. for a draft agent that has no id yet.
     */
    apiLive?: boolean
    /** Disables Slack and Telegram while the connections are loading or failed to load. */
    channelsUnavailable?: boolean
}

/** The Publish menu's items, in order: Slack, Telegram, API. */
export const buildPublishItems = ({
    connections,
    agentId,
    apiLive,
    channelsUnavailable = false,
}: BuildPublishItemsOptions): PublishMenuItem[] => [
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
    {key: "api", live: apiLive ?? !!agentId},
]
