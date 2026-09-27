import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {createStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {beforeEach, describe, expect, it, vi} from "vitest"

const {fetchRevisionsMock} = vi.hoisted(() => ({fetchRevisionsMock: vi.fn()}))

vi.mock("../../src/workflow/api", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/workflow/api")>()
    return {...actual, fetchWorkflowRevisionsByIdsBatch: fetchRevisionsMock}
})

import {AGENT_BUILD_KIT_WORKFLOW_SLUG} from "../../src/workflow/api"
import type {Workflow} from "../../src/workflow/core"
import {
    workflowBuildKitOverlayReadyAtomFamily,
    workflowLocalServerDataAtomFamily,
} from "../../src/workflow/state/store"

const PROJECT_ID = "proj-1"
const AGENT = {flags: {is_agent: true}, data: {uri: "agenta:builtin:agent:v0"}}

function makeStore() {
    const queryClient = new QueryClient()
    const store = createStore()
    store.set(queryClientAtom, queryClient)
    store.set(projectIdAtom, PROJECT_ID)
    store.set(sessionAtom, true)
    queryClient.setQueryData(["agentBuildKitOverlay", AGENT_BUILD_KIT_WORKFLOW_SLUG, PROJECT_ID], {
        tools: [{op: "read_file", type: "platform"}],
    })
    return {store, queryClient}
}

describe("workflowBuildKitOverlayReadyAtomFamily", () => {
    beforeEach(() => {
        fetchRevisionsMock.mockReset()
        workflowBuildKitOverlayReadyAtomFamily.setShouldRemove(() => true)
        workflowBuildKitOverlayReadyAtomFamily.setShouldRemove(null)
    })

    it("is not ready while the revision is loading and no local entity exists", () => {
        fetchRevisionsMock.mockReturnValue(new Promise(() => {}))
        const {store} = makeStore()

        expect(store.get(workflowBuildKitOverlayReadyAtomFamily("rev-cold"))).toBe(false)
    })

    it("is ready once the revision has loaded", () => {
        const {store, queryClient} = makeStore()
        queryClient.setQueryData(["workflows", "revision", "rev-loaded", PROJECT_ID], {
            id: "rev-loaded",
            ...AGENT,
        } as Workflow)

        expect(store.get(workflowBuildKitOverlayReadyAtomFamily("rev-loaded"))).toBe(true)
    })

    it("is ready for a local draft entity", () => {
        const {store} = makeStore()
        store.set(workflowLocalServerDataAtomFamily("local-agent-1"), {
            id: "local-agent-1",
            ...AGENT,
        } as Workflow)

        expect(store.get(workflowBuildKitOverlayReadyAtomFamily("local-agent-1"))).toBe(true)
    })
})
