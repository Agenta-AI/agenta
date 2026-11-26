// @vitest-environment jsdom
/**
 * The run pane of the selected revision: which of the skeleton, the chat panel and the runs panel
 * it shows, whether the trace footer is offered, and what the footer does. The panels and the
 * queries are stubs; their own tests cover them.
 */
import {act} from "react"

import {traceDrawerAtom} from "@agenta/observability/traceDrawer"
import {getDefaultStore} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {PlaygroundRunPane} from "@/features/playground/PlaygroundRunPane"

const atoms = await vi.hoisted(async () => {
    const {atom} = await import("jotai")
    return {
        query: atom({isPending: false}),
        isChat: atom<boolean | undefined>(false),
        canViewSpans: atom(true),
    }
})

vi.mock("@agenta/entities/workflow", () => ({
    workflowMolecule: {selectors: {query: () => atoms.query}},
}))
vi.mock("@agenta/entities/access", () => ({canViewSpansAtom: atoms.canViewSpans}))
vi.mock("@agenta/playground", () => ({
    executionController: {selectors: {isChatMode: atoms.isChat}},
}))
vi.mock("@agenta/playground-ui/panels/runs", () => ({
    RunsPanel: ({
        revisionId,
        renderTraceFooter,
    }: {
        revisionId: string
        renderTraceFooter?: (traceId: string) => React.ReactNode
    }) => (
        <div data-testid="runs-panel">
            {revisionId}
            {renderTraceFooter?.("trace-1")}
        </div>
    ),
    RunsPanelSkeleton: () => <div data-testid="runs-panel-skeleton" />,
}))
// The test set menu has its own tests.
vi.mock("@/features/playground/PlaygroundTestsetMenu", () => ({
    PlaygroundTestsetMenu: () => null,
}))
vi.mock("@agenta/playground-ui/panels/chat", () => ({
    ChatPanel: ({
        revisionId,
        renderTraceFooter,
    }: {
        revisionId: string
        renderTraceFooter?: (traceId: string) => React.ReactNode
    }) => (
        <div data-testid="chat-panel">
            {revisionId}
            {renderTraceFooter?.("trace-1")}
        </div>
    ),
}))
vi.mock("@agenta/entity-ui", () => ({
    SharedGenerationResultUtils: ({
        traceId,
        onViewTrace,
    }: {
        traceId: string
        onViewTrace: (params: {traceId: string; spanId?: string | null}) => void
    }) => (
        <button type="button" onClick={() => onViewTrace({traceId, spanId: "span-1"})}>
            Open trace
        </button>
    ),
}))

const store = getDefaultStore()
let root: Root
let host: HTMLDivElement

const render = async () => {
    await act(async () => root.render(<PlaygroundRunPane revisionId="rev-1" />))
}
const byTestId = (id: string) => host.querySelector(`[data-testid="${id}"]`)

beforeEach(() => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    store.set(atoms.query, {isPending: false})
    store.set(atoms.isChat, false)
    store.set(atoms.canViewSpans, true)
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

describe("PlaygroundRunPane", () => {
    it("A completion app shows the run pane", async () => {
        await render()

        expect(byTestId("runs-panel")?.textContent).toContain("rev-1")
        expect(byTestId("chat-panel")).toBeNull()
    })

    it("A chat app shows the chat pane", async () => {
        store.set(atoms.isChat, true)
        await render()

        // The chat panel loads on demand.
        await vi.waitFor(() => expect(byTestId("chat-panel")?.textContent).toContain("rev-1"))
        expect(byTestId("runs-panel")).toBeNull()
    })

    it("A pending revision or an unknown app kind shows the skeleton", async () => {
        store.set(atoms.query, {isPending: true})
        await render()
        expect(byTestId("runs-panel-skeleton")).not.toBeNull()

        store.set(atoms.query, {isPending: false})
        store.set(atoms.isChat, undefined)
        await render()
        expect(byTestId("runs-panel-skeleton")).not.toBeNull()
    })

    it("The trace footer opens the trace drawer on that trace", async () => {
        await render()

        const open = [...host.querySelectorAll("button")].find(
            (button) => button.textContent === "Open trace",
        )!
        await act(async () => open.click())

        expect(store.get(traceDrawerAtom)).toMatchObject({
            open: true,
            traceId: "trace-1",
            activeSpanId: "span-1",
        })
    })

    it("No trace footer without span access", async () => {
        store.set(atoms.canViewSpans, false)
        await render()

        expect(host.textContent).not.toContain("Open trace")
        expect(byTestId("runs-panel")).not.toBeNull()
    })
})
