import type {ReactNode} from "react"

import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createStore, Provider} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"

export const PROJECT_ID = "project-1"

export interface TestFolder {
    id: string
    name: string
    slug?: string
    parent_id?: string | null
}

export interface TestPrompt {
    id: string
    name: string
    folder_id?: string | null
    /** Set on the latest revision only: the list flags of a real app carry no chat flag. */
    is_chat?: boolean
    is_agent?: boolean
    deleted_at?: string | null
    created_at?: string
    updated_at?: string
}

const ref = (prompt: TestPrompt) => ({
    id: prompt.id,
    name: prompt.name,
    slug: prompt.id,
    description: null,
    flags: {is_evaluator: false},
    tags: null,
    deleted_at: prompt.deleted_at ?? null,
    created_at: prompt.created_at ?? "2026-01-01T00:00:00Z",
    updated_at: prompt.updated_at ?? prompt.created_at ?? "2026-01-01T00:00:00Z",
    created_by_id: null,
    access: null,
    folder_id: prompt.folder_id ?? null,
})

/** A jotai store and query client with the folder and prompt lists already cached. */
export const makePromptsStore = ({
    folders,
    prompts,
}: {
    folders?: TestFolder[]
    prompts?: TestPrompt[]
}) => {
    const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
    const store = createStore()
    store.set(queryClientAtom, queryClient)
    store.set(projectIdAtom, PROJECT_ID)
    store.set(sessionAtom, true)
    if (folders) queryClient.setQueryData(["folders", PROJECT_ID], folders)
    if (prompts) {
        queryClient.setQueryData(["workflows", "apps", "list", PROJECT_ID], {
            count: prompts.length,
            refs: prompts.map(ref),
        })
        queryClient.setQueryData(
            ["workflows", "apps", "agentFlags", PROJECT_ID],
            new Map(prompts.map((prompt) => [prompt.id, prompt.is_agent === true])),
        )
        for (const prompt of prompts) {
            queryClient.setQueryData(["workflows", "latestRevision", prompt.id, PROJECT_ID], {
                id: `${prompt.id}-rev`,
                slug: `${prompt.id}-rev`,
                version: 1,
                flags: {is_chat: prompt.is_chat === true},
                data: {uri: `agenta:builtin:${prompt.is_chat ? "chat" : "completion"}:v0`},
            })
        }
    }
    return {store, queryClient}
}

export const PromptsTestProviders = ({
    store,
    queryClient,
    children,
}: {
    store: ReturnType<typeof createStore>
    queryClient: QueryClient
    children: ReactNode
}) => (
    <QueryClientProvider client={queryClient}>
        <Provider store={store}>{children}</Provider>
    </QueryClientProvider>
)
