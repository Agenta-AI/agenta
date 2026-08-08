import type {AgentaApi} from "@agentaai/api-client"
import {useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {projectIdAtom} from "@/oss/state/project"

import {
    listChannelAgents,
    listChannelGrants,
    listChannelSpaces,
    listChannels,
    queryChannelConnections,
    queryChannelGrants,
    queryChannelInboxEvents,
    queryChannelOutboxEvents,
    queryChannelThreads,
} from "../api"

// --- catalog -------------------------------------------------------------- //

export const channelsCatalogQueryAtom = atomWithQuery<AgentaApi.ChannelsCatalogResponse>((get) => ({
    queryKey: ["channels", "catalog", get(projectIdAtom)],
    queryFn: () => listChannels(),
    enabled: !!get(projectIdAtom),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
}))

// --- connections (read-only view over gateway_connections) --------------- //

export const channelConnectionsQueryAtom = atomWithQuery<AgentaApi.ChannelConnectionsResponse>(
    (get) => ({
        queryKey: ["channels", "connections", get(projectIdAtom)],
        queryFn: () => queryChannelConnections(),
        enabled: !!get(projectIdAtom),
        staleTime: 30_000,
        refetchOnWindowFocus: false,
    }),
)

export const useChannelConnectionsQuery = () => {
    const query = useAtomValue(channelConnectionsQueryAtom)
    return {
        connections: query.data?.connections ?? [],
        count: query.data?.count ?? 0,
        isLoading: query.isPending,
        error: query.error,
        refetch: query.refetch,
    }
}

// --- agents ---------------------------------------------------------------- //

export const channelAgentsQueryAtom = atomWithQuery<AgentaApi.ChannelAgentsResponse>((get) => ({
    queryKey: ["channels", "agents", get(projectIdAtom)],
    queryFn: () => listChannelAgents(),
    enabled: !!get(projectIdAtom),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
}))

export const useChannelAgentsQuery = () => {
    const query = useAtomValue(channelAgentsQueryAtom)
    return {
        agents: query.data?.agents ?? [],
        count: query.data?.count ?? 0,
        isLoading: query.isPending,
        error: query.error,
        refetch: query.refetch,
    }
}

// --- spaces ----------------------------------------------------------------- //

export const channelSpacesQueryAtom = atomWithQuery<AgentaApi.ChannelSpacesResponse>((get) => ({
    queryKey: ["channels", "spaces", get(projectIdAtom)],
    queryFn: () => listChannelSpaces(),
    enabled: !!get(projectIdAtom),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
}))

export const useChannelSpacesQuery = () => {
    const query = useAtomValue(channelSpacesQueryAtom)
    return {
        spaces: query.data?.spaces ?? [],
        count: query.data?.count ?? 0,
        isLoading: query.isPending,
        error: query.error,
        refetch: query.refetch,
    }
}

// --- grants ------------------------------------------------------------------ //

export const channelGrantsQueryAtom = atomWithQuery<AgentaApi.ChannelGrantsResponse>((get) => ({
    queryKey: ["channels", "grants", get(projectIdAtom)],
    queryFn: () => listChannelGrants(),
    enabled: !!get(projectIdAtom),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
}))

export const useChannelGrantsQuery = () => {
    const query = useAtomValue(channelGrantsQueryAtom)
    return {
        grants: query.data?.grants ?? [],
        count: query.data?.count ?? 0,
        isLoading: query.isPending,
        error: query.error,
        refetch: query.refetch,
    }
}

// grants scoped to one agent (agent detail screen's sub-list)
export const channelGrantsByAgentQueryAtomFamily = atomFamily((agentId: string) =>
    atomWithQuery<AgentaApi.ChannelGrantsResponse>((get) => ({
        queryKey: ["channels", "grants", "by-agent", agentId, get(projectIdAtom)],
        queryFn: () => queryChannelGrants({agent_id: agentId}),
        enabled: !!get(projectIdAtom) && !!agentId,
        staleTime: 15_000,
        refetchOnWindowFocus: false,
    })),
)

// grants scoped to one space (space detail screen's sub-list)
export const channelGrantsBySpaceQueryAtomFamily = atomFamily((spaceId: string) =>
    atomWithQuery<AgentaApi.ChannelGrantsResponse>((get) => ({
        queryKey: ["channels", "grants", "by-space", spaceId, get(projectIdAtom)],
        queryFn: () => queryChannelGrants({space_id: spaceId}),
        enabled: !!get(projectIdAtom) && !!spaceId,
        staleTime: 15_000,
        refetchOnWindowFocus: false,
    })),
)

// --- threads ------------------------------------------------------------------ //

export interface ChannelThreadsFilter {
    space_id?: string
    agent_id?: string
}

export const channelThreadsQueryAtomFamily = atomFamily(
    (filter: ChannelThreadsFilter) =>
        atomWithQuery<AgentaApi.ChannelThreadsResponse>((get) => ({
            queryKey: ["channels", "threads", filter, get(projectIdAtom)],
            queryFn: () => queryChannelThreads(filter),
            enabled: !!get(projectIdAtom),
            staleTime: 10_000,
            refetchOnWindowFocus: false,
        })),
    (a, b) => a.space_id === b.space_id && a.agent_id === b.agent_id,
)

// --- inbox / outbox observability ---------------------------------------- //

export interface ChannelEventsFilter {
    space_id?: string
    connection_id?: string
    thread_id?: string
}

export const channelInboxEventsQueryAtomFamily = atomFamily(
    (filter: ChannelEventsFilter) =>
        atomWithQuery<AgentaApi.ChannelInboxEventsResponse>((get) => ({
            queryKey: ["channels", "inbox-events", filter, get(projectIdAtom)],
            queryFn: () =>
                queryChannelInboxEvents({
                    space_id: filter.space_id,
                    connection_id: filter.connection_id,
                }),
            enabled: !!get(projectIdAtom),
            staleTime: 10_000,
            refetchOnWindowFocus: false,
        })),
    (a, b) => a.space_id === b.space_id && a.connection_id === b.connection_id,
)

export const channelOutboxEventsQueryAtomFamily = atomFamily(
    (filter: ChannelEventsFilter) =>
        atomWithQuery<AgentaApi.ChannelOutboxEventsResponse>((get) => ({
            queryKey: ["channels", "outbox-events", filter, get(projectIdAtom)],
            queryFn: () =>
                queryChannelOutboxEvents({
                    thread_id: filter.thread_id,
                }),
            enabled: !!get(projectIdAtom),
            staleTime: 10_000,
            refetchOnWindowFocus: false,
        })),
    (a, b) => a.thread_id === b.thread_id,
)
