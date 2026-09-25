import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {createStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {describe, expect, it} from "vitest"

import {DEFAULT_AGENTA_TOOLS} from "../../src/workflow/agentaTools"
import {workflowIsDirtyAtomFamily, workflowQueryAtomFamily} from "../../src/workflow/state/store"

const REVISION = "0199aaaa-0000-7000-8000-000000000001"
const PROJECT = "0199aaaa-0000-7000-8000-000000000002"

function storeWith(tools: unknown[]) {
    const queryClient = new QueryClient()
    queryClient.setQueryData(["workflows", "revision", REVISION, PROJECT], {
        id: REVISION,
        workflow_id: "0199aaaa-0000-7000-8000-000000000003",
        data: {uri: "agenta:builtin:agent:v0", parameters: {agent: {tools}}},
    })
    const store = createStore()
    store.set(queryClientAtom, queryClient)
    store.set(projectIdAtom, PROJECT)
    store.set(sessionAtom, true)
    return store
}

const loadedTools = (store: ReturnType<typeof createStore>) =>
    (store.get(workflowQueryAtomFamily(REVISION)).data?.data?.parameters as {
        agent: {tools: unknown[]}
    }).agent.tools

describe("loading a revision in the playground", () => {
    it("adds the default entry to an agent saved without one, without a draft", () => {
        const store = storeWith([])
        expect(loadedTools(store)).toEqual([{type: "agenta_tools", tools: DEFAULT_AGENTA_TOOLS}])
        expect(store.get(workflowIsDirtyAtomFamily(REVISION))).toBe(false)
    })

    it("keeps an empty entry empty", () => {
        const store = storeWith([{type: "agenta_tools", tools: {}}])
        expect(loadedTools(store)).toEqual([{type: "agenta_tools", tools: {}}])
    })
})
