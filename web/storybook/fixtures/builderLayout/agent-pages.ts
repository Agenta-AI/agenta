import type {AgentSharingState} from "@agenta/entities/sharing"
import {EMPTY_CONNECTIONS, type ChannelConnections} from "@agenta/settings-ui"

// The channel fixtures the settings package already keeps for its own stories.
import {
    AGENT_ID,
    slackHere,
    slackRevoked,
} from "../../../packages/agenta-settings-ui/src/channels/storyFixtures"

export const agentPagesAgentId = AGENT_ID
export const agentPagesAgentName = "Support triage"

/** A07: Slack connected, the other platforms to add. */
export const channelsSlackConnected: ChannelConnections = {...EMPTY_CONNECTIONS, slack: slackHere}

/** A07, broken: Slack lost its access. */
export const channelsSlackRevoked: ChannelConnections = {...EMPTY_CONNECTIONS, slack: slackRevoked}

export const owner = {user_id: "u-lena", email: "lena@acme-agency.example", name: "Lena Maier"}

/** A06: a private agent of the person viewing it. */
export const privateOwnedSharing: AgentSharingState = {
    policy: {visibility: "private", owner_user_id: owner.user_id},
    owner_is_active: true,
    my_role: "owner",
    can_take_ownership: false,
}
