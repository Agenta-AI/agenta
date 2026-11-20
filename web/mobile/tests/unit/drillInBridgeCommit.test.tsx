// @vitest-environment jsdom
/**
 * The config editor host (`DrillInBridgeProvider`) serves two screens: the agent session, which
 * pins a committed revision to its session, and the prompt playground, which has no session and
 * follows the committed revision itself. The host takes the commit follow-up as a prop.
 */
import {act, useEffect} from "react"

import {useDrillInUI} from "@agenta/entity-ui/drill-in"
import {QueryClientProvider} from "@tanstack/react-query"
import {createStore, Provider} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {AgentPanelContext, type AgentPanelApi} from "@/features/agent-layout/agentPanelContext"
import {ConfigurationContent} from "@/features/agent-layout/ConfigurationContent"
import {DrillInBridgeProvider} from "@/features/chat/DrillInBridgeProvider"
import {selectedRevisionAtomFamily} from "@/features/chat/selectedRevision"
import {queryClient} from "@/lib/queryClient"

const projectId = "commit-test-project"

vi.mock("next/router", async (original) => ({
    ...(await original<object>()),
    useRouter: () => ({query: {}, basePath: "", asPath: "/"}),
}))

/** Stands in for the config editor: it commits "rev-2" through the host, as a Commit does. */
const CommitsRevision = () => {
    const {onWorkflowRevisionCommitted} = useDrillInUI()
    useEffect(() => {
        onWorkflowRevisionCommitted?.("rev-2")
    }, [onWorkflowRevisionCommitted])
    return null
}

// The panel's tabs are heavy and not under test: the Configuration root becomes the committer.
vi.mock("@/features/agent-layout/ConfigurationRoot", () => ({
    ConfigurationRoot: () => <CommitsRevision />,
}))
vi.mock("@/features/agent-layout/StackGuards", () => ({StackGuards: () => null}))

const panel: AgentPanelApi = {
    content: "configuration",
    toggle: async () => true,
    close: async () => true,
    configTab: "agent",
    setConfigTab: () => undefined,
    wide: false,
    setWide: () => undefined,
    phone: false,
    available: {files: true, configuration: true, builder: false},
}

let root: Root
let host: HTMLDivElement
let store: ReturnType<typeof createStore>

const render = async (node: React.ReactNode) => {
    queryClient.setQueryData(["mobile", "project-permission", projectId, "edit_secret"], false)
    await act(async () => {
        root.render(
            <QueryClientProvider client={queryClient}>
                <Provider store={store}>{node}</Provider>
            </QueryClientProvider>,
        )
    })
}

beforeEach(() => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    store = createStore()
    store.set(queryClientAtom, queryClient)
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

describe("the config editor host", () => {
    it("The agent configuration still pins the committed revision to the session", async () => {
        await render(
            <AgentPanelContext.Provider value={panel}>
                <ConfigurationContent
                    agentId="agent-1"
                    revisionId="rev-1"
                    sessionId="session-1"
                    filesScope="session-1"
                    workspaceId="ws-1"
                    projectId={projectId}
                />
            </AgentPanelContext.Provider>,
        )

        expect(store.get(selectedRevisionAtomFamily("session-1"))).toBe("rev-2")
    })

    it("A host without a session receives the committed revision id", async () => {
        const committed = vi.fn()
        await render(
            <DrillInBridgeProvider projectId={projectId} onWorkflowRevisionCommitted={committed}>
                <CommitsRevision />
            </DrillInBridgeProvider>,
        )

        expect(committed).toHaveBeenCalledWith("rev-2")
    })
})
