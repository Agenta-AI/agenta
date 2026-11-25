// @vitest-environment jsdom
//
// The Configuration panel footer (canvas S02): "History" opens the version history, and the
// status reads "Saved as vN" while saved, or the save state while a save waits or failed.
import {act} from "react"

import * as workflow from "@agenta/entities/workflow"
import * as playground from "@agenta/playground/state"
import {AgentRevisionStatus} from "@agenta/playground-ui/agent-page-header"
import {createStore, Provider, type Atom, type PrimitiveAtom} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const history = vi.hoisted(() => ({opened: [] as string[]}))
const watch = vi.hoisted(() => ({
    latest: null as null | ((next: {workflowId: string; id: string; version: number}) => void),
}))

vi.mock("next/dynamic", () => ({default: () => () => null}))
vi.mock("@agenta/ui/ui", () => ({
    SimpleTooltip: ({children}: {children: React.ReactNode}) => children,
    Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
}))
vi.mock("@agenta/shared/state", async () => {
    const {atom} = await import("jotai")
    return {projectIdAtom: atom("project-1")}
})
vi.mock("@agenta/entities/workflow", async () => {
    const {atom} = await import("jotai")
    const dirtyAtom = atom(false)
    const dataAtoms = new Map<string, Atom<{version: number | null; message: string}>>()
    const data = (revisionId: string) => {
        const version = Number(revisionId.replace("revision-", ""))
        if (!dataAtoms.has(revisionId))
            dataAtoms.set(revisionId, atom({version: version || null, message: ""}))
        return dataAtoms.get(revisionId)
    }
    const agent = atom(true)
    return {
        dirtyAtom,
        revalidateAgentRevisionReads: () => undefined,
        workflowMolecule: {selectors: {data, isDirty: () => dirtyAtom, isAgent: () => agent}},
    }
})
vi.mock("@agenta/playground/state", async () => {
    const {atom} = await import("jotai")
    const statusAtom = atom<string | null>(null)
    const scheduledAtom = atom(false)
    const errorAtom = atom<string | null>(null)
    return {
        statusAtom,
        scheduledAtom,
        agentAutoCommitStatusAtomFamily: () => statusAtom,
        agentAutoCommitScheduledAtomFamily: () => scheduledAtom,
        agentAutoCommitErrorAtomFamily: () => errorAtom,
        flushAgentAutoCommitAtom: atom(null, () => undefined),
        watchLatestVersion: ({
            workflowId,
            onLatest,
        }: {
            workflowId: string
            onLatest: (next: {workflowId: string; id: string; version: number}) => void
        }) => {
            watch.latest = (next) => onLatest({...next, workflowId: next.workflowId ?? workflowId})
            return () => undefined
        },
    }
})
vi.mock("../../../packages/agenta-playground-ui/src/components/AgentVersionHistory", async () => {
    const {atom} = await import("jotai")
    const closed = atom(false)
    return {
        versionHistoryOpenAtomFamily: () => closed,
        openAgentVersionHistoryAtom: atom(null, (_get, _set, id: string) =>
            history.opened.push(id),
        ),
    }
})

const {dirtyAtom} = workflow as unknown as {dirtyAtom: PrimitiveAtom<boolean>}
const {statusAtom} = playground as unknown as {statusAtom: PrimitiveAtom<string | null>}

;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

describe("AgentRevisionStatus footer", () => {
    let container: HTMLDivElement
    let root: Root
    let store: ReturnType<typeof createStore>

    const render = () =>
        act(async () => {
            root.render(
                <Provider store={store}>
                    <AgentRevisionStatus
                        revisionId="revision-4"
                        historyWorkflowId="agent-1"
                        footer
                    />
                </Provider>,
            )
        })
    const buttons = () => [...container.querySelectorAll("button")]

    beforeEach(() => {
        history.opened = []
        store = createStore()
        container = document.createElement("div")
        document.body.appendChild(container)
        root = createRoot(container)
    })
    afterEach(() => {
        act(() => root.unmount())
        container.remove()
    })

    it("shows History and a disabled Saved as vN", async () => {
        await render()
        expect(buttons().map((b) => b.textContent)).toEqual(["History", "Saved as v4"])
        expect(buttons()[1].disabled).toBe(true)
        await act(async () => buttons()[0].click())
        expect(history.opened).toEqual(["agent-1"])
    })

    it("shows the save state while the version has changes not saved yet", async () => {
        store.set(dirtyAtom, true)
        await render()
        expect(buttons()[1].textContent).toBe("Draft")
    })

    it("turns the status into the retry when the save failed", async () => {
        store.set(statusAtom, "error")
        await render()
        expect(buttons()[1].disabled).toBe(false)
        expect(buttons()[1].getAttribute("aria-label")).toBe("Retry saving changes")
    })
})
