import {queryClient} from "@agenta/shared/api"
import {atom} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

import {localApi} from "@/lib/api/client"
import type {AgentInput, RevisionInput} from "@/lib/api/types"

export const agentKeys = {
    all: ["local", "agents"] as const,
    detail: (id: string) => ["local", "agents", id] as const,
}
export const selectedAgentIdAtom = atom<string | null>(null)

export const agentsQueryAtom = atomWithQuery(() => ({
    queryKey: agentKeys.all,
    queryFn: localApi.listAgents,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
}))

export const selectedAgentQueryAtom = atomWithQuery((get) => {
    const id = get(selectedAgentIdAtom)
    return {
        queryKey: agentKeys.detail(id ?? "none"),
        queryFn: () => localApi.getAgent(id!),
        enabled: Boolean(id),
    }
})

export async function createAgent(input: AgentInput) {
    const agent = await localApi.createAgent(input)
    queryClient.setQueryData(agentKeys.detail(agent.id), agent)
    await queryClient.invalidateQueries({queryKey: agentKeys.all})
    return agent
}

export async function commitAgentRevision(id: string, input: RevisionInput) {
    const revision = await localApi.commitRevision(id, input)
    await Promise.all([
        queryClient.invalidateQueries({queryKey: agentKeys.all}),
        queryClient.invalidateQueries({queryKey: agentKeys.detail(id)}),
    ])
    return revision
}

export async function deleteAgent(id: string) {
    await localApi.deleteAgent(id)
    queryClient.removeQueries({queryKey: agentKeys.detail(id)})
    await queryClient.invalidateQueries({queryKey: agentKeys.all})
}
