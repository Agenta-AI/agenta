import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {keepPreviousData} from "@tanstack/react-query"
import {atom} from "jotai"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {agentStarterTemplateFromEntry, type AgentStarterTemplate} from "../agentTemplates"
import {queryAgentTemplates} from "../api/agentTemplates"

export type AgentTemplatesStatus = "pending" | "error" | "success"

/** The bundled template catalog, served by the API. It changes only with a release. */
export const agentTemplatesQueryAtom = atomWithQuery((get) => {
    const projectId = get(projectIdAtom)
    return {
        queryKey: ["agentTemplates", projectId],
        queryFn: async (): Promise<AgentStarterTemplate[]> => {
            const response = await queryAgentTemplates(projectId as string)
            return response.templates.map(agentStarterTemplateFromEntry)
        },
        enabled: get(sessionAtom) && !!projectId,
        // The catalog is the same for every project; keep it on screen across a project switch.
        placeholderData: keepPreviousData,
        staleTime: 30 * 60_000,
        refetchOnWindowFocus: false,
        // One retry on top of the transport's none: a failed read reaches the error state fast.
        retry: 1,
    }
})

const EMPTY: AgentStarterTemplate[] = []

/** Catalog cards; empty until the query succeeds — read the status to tell loading from empty. */
export const agentTemplatesAtom = atom<AgentStarterTemplate[]>(
    (get) => get(agentTemplatesQueryAtom).data ?? EMPTY,
)

/** Loaded data wins: a failed background refetch must not hide a catalog already on screen. */
export const agentTemplatesStatusAtom = atom<AgentTemplatesStatus>((get) => {
    const query = get(agentTemplatesQueryAtom)
    if (query.data !== undefined) return "success"
    if (query.isError && !query.isFetching) return "error"
    return "pending"
})

/** Retry a failed catalog read (the retry action of a catalog error state). */
export const refetchAgentTemplatesAtom = atom(null, (get) => {
    void get(agentTemplatesQueryAtom).refetch()
})

export type AgentTemplateLookup =
    | {status: "pending" | "error"; template?: undefined}
    | {status: "found"; template: AgentStarterTemplate}
    | {status: "missing"; template?: undefined}

/**
 * One key against the catalog. "missing" only once the catalog has loaded without it — a key
 * must never read as unavailable while the catalog is still loading or failed to load.
 */
export const agentTemplateLookupAtomFamily = atomFamily((key: string) =>
    atom<AgentTemplateLookup>((get) => {
        const status = get(agentTemplatesStatusAtom)
        if (status !== "success") return {status}
        const template = get(agentTemplatesAtom).find((item) => item.key === key)
        return template ? {status: "found", template} : {status: "missing"}
    }),
)
