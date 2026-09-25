import {atom} from "jotai"
import {atomFamily, atomWithStorage} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {queryChannelSpaces, queryChannelThreads} from "@/oss/state/channels"
import {projectIdAtom} from "@/oss/state/project"

import {queryAgentaConnections, readAgentaConversation} from "./api"

/** The selected bot (a `channel = "agenta"` connection). Not persisted — reselect on reload. */
export const selectedConnectionIdAtom = atom<string | null>(null)

/** Pasted or freshly-minted; kept in memory only, never written to storage. */
export const agentaApiKeyAtom = atom<string>("")

/** Numbered-list / label:value / bare-URL toggle for every node in the vocabulary. */
export const degradedRenderingAtom = atomWithStorage<boolean>(
    "agenta:agenta-channel-surface:degraded",
    false,
)

export const agentaConnectionsQueryAtom = atomWithQuery((get) => ({
    queryKey: ["agenta-channel-surface", "connections", get(projectIdAtom)],
    queryFn: () => queryAgentaConnections(),
    enabled: !!get(projectIdAtom),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
}))

/** The signed-in user's own space for a bot -- one private space per (bot, user), auto-created on first message. */
export const agentaSpaceForConnectionQueryAtomFamily = atomFamily(
    (args: {connectionId: string; userId: string}) =>
        atomWithQuery((get) => ({
            queryKey: [
                "agenta-channel-surface",
                "space",
                args.connectionId,
                args.userId,
                get(projectIdAtom),
            ],
            queryFn: async () => {
                const {spaces} = await queryChannelSpaces({connection_id: args.connectionId})
                return (
                    (spaces ?? []).find(
                        (space) => space.data?.external_locator?.user === args.userId,
                    ) ?? null
                )
            },
            enabled: !!get(projectIdAtom) && !!args.connectionId,
            // Short: right after the first message, the space is created
            // asynchronously by the inbox worker, not by the POST itself.
            refetchInterval: 3_000,
            refetchOnWindowFocus: false,
        })),
    (a, b) => a.connectionId === b.connectionId && a.userId === b.userId,
)

/** The threads (conversations) within one space -- "open or resume" picks from this. */
export const agentaThreadsForSpaceQueryAtomFamily = atomFamily((spaceId: string) =>
    atomWithQuery((get) => ({
        queryKey: ["agenta-channel-surface", "threads", spaceId, get(projectIdAtom)],
        queryFn: () => queryChannelThreads({space_id: spaceId}),
        enabled: !!get(projectIdAtom) && !!spaceId,
        staleTime: 5_000,
        refetchOnWindowFocus: false,
    })),
)

/** The space's merged read (inbox + outbox), polled while a conversation is open. */
export const agentaConversationQueryAtomFamily = atomFamily((spaceId: string) =>
    atomWithQuery((get) => ({
        queryKey: ["agenta-channel-surface", "conversation", spaceId, get(projectIdAtom)],
        queryFn: () => readAgentaConversation(spaceId),
        enabled: !!get(projectIdAtom) && !!spaceId,
        refetchInterval: 3_000,
        refetchOnWindowFocus: false,
    })),
)
