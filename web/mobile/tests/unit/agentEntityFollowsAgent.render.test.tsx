// @vitest-environment jsdom
//
// Only a session that names the agent itself follows the agent's versions. A trigger may bind a
// variant or a revision, and that session stays where it was bound.
import {act, type ReactNode} from "react"

import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const header = vi.hoisted(() => ({references: [] as {key: string; id: string}[]}))

vi.mock("@agenta/entities/workflow", () => ({
    retrieveWorkflowRevision: async ({workflowRef}: {workflowRef?: {id: string}}) =>
        workflowRef?.id === WORKFLOW || !workflowRef
            ? {id: "11111111-1111-4111-8111-111111111111", workflow_id: WORKFLOW}
            : null,
    primeWorkflowRevisionDetailCacheImperative: () => undefined,
}))
vi.mock("@/features/chat/useSessionHeader", () => ({
    useSessionHeader: () => ({
        data: {references: header.references},
        isSuccess: true,
        isPending: false,
        isFetching: false,
        isError: false,
        refetch: async () => undefined,
    }),
}))

import {useAgentEntity} from "@/features/chat/useAgentEntity"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const WORKFLOW = "22222222-2222-4222-8222-222222222222"
const REVISION = "33333333-3333-4333-8333-333333333333"

describe("useAgentEntity followsAgent", () => {
    let host: HTMLDivElement
    let root: Root
    let seen: ReturnType<typeof useAgentEntity> | undefined

    const Probe = () => {
        seen = useAgentEntity("session-1", "project-1")
        return null
    }
    const mount = async (wrap: (node: ReactNode) => ReactNode) => {
        await act(async () => root.render(wrap(<Probe />)))
        await act(async () => new Promise((resolve) => setTimeout(resolve, 20)))
    }
    const withClient = (node: ReactNode) => (
        <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>
    )

    beforeEach(() => {
        seen = undefined
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
    })
    afterEach(async () => {
        await act(async () => root.unmount())
        host.remove()
    })

    it("is true for a session bound to the workflow", async () => {
        header.references = [{key: "workflow", id: WORKFLOW}]
        await mount(withClient)
        expect(seen?.agentId).toBe(WORKFLOW)
        expect(seen?.followsAgent).toBe(true)
    })

    it("is false for a session bound to a revision of that workflow", async () => {
        header.references = [{key: "workflow_revision", id: REVISION}]
        await mount(withClient)
        expect(seen?.agentId).toBe(WORKFLOW)
        expect(seen?.followsAgent).toBe(false)
    })
})
