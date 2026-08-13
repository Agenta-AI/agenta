import {safeParseWithLogging} from "@agenta/entities/shared"
import {getChannelsClient} from "@agenta/sdk/resources"
import type {AgentaApi} from "@agentaai/api-client"
import {getDefaultStore} from "jotai"

import {projectIdAtom} from "@/oss/state/project"

import {channelConnectionsResponseSchema, type ChannelConnectionsResponse} from "./schemas"

const scope = () => {
    const projectId = getDefaultStore().get(projectIdAtom)
    return projectId ? {queryParams: {project_id: projectId}} : undefined
}

// --- catalog ----------------------------------------------------------- //

export const listChannels = () => getChannelsClient().listChannels(scope())

export const fetchChannelCapabilities = (channel: string) =>
    getChannelsClient().fetchChannelCapabilities({channel}, scope())

// Reachable before any connection exists -- the step that precedes `fetchChannelConnectionSetup`.
export const fetchChannelSetup = (channel: string) =>
    getChannelsClient().fetchChannelSetup({channel}, scope())

// --- connections (own row shape — see schemas.ts for why this validates) - //

export const queryChannelConnections = async (
    query?: AgentaApi.ChannelConnectionQueryRequest,
): Promise<ChannelConnectionsResponse> => {
    const data = await getChannelsClient().queryChannelConnections(query ?? {}, scope())
    return (
        safeParseWithLogging(
            channelConnectionsResponseSchema,
            data,
            "[queryChannelConnections]",
        ) ?? {count: 0, connections: []}
    )
}

export const createChannelConnection = (connection: AgentaApi.ChannelConnectionCreate) =>
    getChannelsClient().createChannelConnection({connection}, scope())

// --- agents -------------------------------------------------------------- //

export const listChannelAgents = () => getChannelsClient().listChannelAgents(scope())

export const queryChannelAgents = (
    agent?: AgentaApi.ChannelAgentQuery,
    windowing?: AgentaApi.Windowing,
) => getChannelsClient().queryChannelAgents({agent, windowing}, scope())

export const fetchChannelAgent = (agentId: string) =>
    getChannelsClient().fetchChannelAgent({agent_id: agentId}, scope())

export const createChannelAgent = (agent: AgentaApi.ChannelAgentCreate) =>
    getChannelsClient().createChannelAgent({agent}, scope())

export const editChannelAgent = (agentId: string, agent: AgentaApi.ChannelAgentEdit) =>
    getChannelsClient().editChannelAgent({agent_id: agentId, agent}, scope())

export const deleteChannelAgent = (agentId: string) =>
    getChannelsClient().deleteChannelAgent({agent_id: agentId}, scope())

export const setChannelAgentDefault = (agentId: string) =>
    getChannelsClient().setChannelAgentDefault({agent_id: agentId}, scope())

// --- spaces ---------------------------------------------------------------- //

export const listChannelSpaces = () => getChannelsClient().listChannelSpaces(scope())

export const queryChannelSpaces = (
    space?: AgentaApi.ChannelSpaceQuery,
    windowing?: AgentaApi.Windowing,
) => getChannelsClient().queryChannelSpaces({space, windowing}, scope())

export const fetchChannelSpace = (spaceId: string) =>
    getChannelsClient().fetchChannelSpace({space_id: spaceId}, scope())

export const createChannelSpace = (space: AgentaApi.ChannelSpaceCreate) =>
    getChannelsClient().createChannelSpace({space}, scope())

export const editChannelSpace = (spaceId: string, space: AgentaApi.ChannelSpaceEdit) =>
    getChannelsClient().editChannelSpace({space_id: spaceId, space}, scope())

export const deleteChannelSpace = (spaceId: string) =>
    getChannelsClient().deleteChannelSpace({space_id: spaceId}, scope())

export const discoverChannelSpaces = (connectionId: string) =>
    getChannelsClient().discoverChannelSpaces({connection_id: connectionId}, scope())

// --- grants ------------------------------------------------------------- //

export const listChannelGrants = () => getChannelsClient().listChannelGrants(scope())

export const queryChannelGrants = (
    grant?: AgentaApi.ChannelGrantQuery,
    windowing?: AgentaApi.Windowing,
) => getChannelsClient().queryChannelGrants({grant, windowing}, scope())

export const createChannelGrant = (grant: AgentaApi.ChannelGrantCreate) =>
    getChannelsClient().createChannelGrant({grant}, scope())

export const editChannelGrant = (grantId: string, grant: AgentaApi.ChannelGrantEdit) =>
    getChannelsClient().editChannelGrant({grant_id: grantId, grant}, scope())

export const deleteChannelGrant = (grantId: string) =>
    getChannelsClient().deleteChannelGrant({grant_id: grantId}, scope())

export const setChannelGrantDefault = (grantId: string) =>
    getChannelsClient().setChannelGrantDefault({grant_id: grantId}, scope())

// --- policy: the explain endpoint --------------------------------------- //

export const resolveChannelPolicy = (agentId: string, spaceId: string) =>
    getChannelsClient().resolveChannelPolicy({agent_id: agentId, space_id: spaceId}, scope())

// --- threads (read + close; never created over the wire) ---------------- //

export const queryChannelThreads = (
    thread?: AgentaApi.ChannelThreadQuery,
    windowing?: AgentaApi.Windowing,
) => getChannelsClient().queryChannelThreads({thread, windowing}, scope())

export const closeChannelThread = (threadId: string) =>
    getChannelsClient().closeChannelThread({thread_id: threadId}, scope())

// --- inbox / outbox observability --------------------------------------- //

export const queryChannelInboxEvents = (
    event?: AgentaApi.ChannelInboxEventQuery,
    windowing?: AgentaApi.Windowing,
) => getChannelsClient().queryChannelInboxEvents({event, windowing}, scope())

export const queryChannelOutboxEvents = (
    event?: AgentaApi.ChannelOutboxEventQuery,
    windowing?: AgentaApi.Windowing,
) => getChannelsClient().queryChannelOutboxEvents({event, windowing}, scope())
