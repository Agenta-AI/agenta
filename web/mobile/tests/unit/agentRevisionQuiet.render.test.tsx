// @vitest-environment jsdom
//
// The quiet status of the agent Configuration page: nothing at rest, "Update to vN" for a newer
// version, and a failed save's retry. The save and version state are plain atoms the cases drive.
import {act} from "react"

import * as playground from "@agenta/playground/state"
import {AgentRevisionStatus} from "@agenta/playground-ui/agent-page-header"
import {createStore, Provider, type Atom, type PrimitiveAtom} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const retries = vi.hoisted(() => [] as unknown[])
const watch = vi.hoisted(() => ({
    latest: null as null | ((next: {workflowId: string; id: string; version: number}) => void),
}))

vi.mock("next/dynamic", () => ({default: () => () => null}))
vi.mock("@agenta/ui/ui", () => ({
    Button: ({
        children,
        variant: _variant,
        size: _size,
        ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & {variant?: string; size?: string}) => (
        <button type="button" {...props}>
            {children}
        </button>
    ),
}))
vi.mock("@agenta/ui/composed", () => ({
    SimpleTooltip: ({children}: {children: React.ReactNode}) => children,
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
        flushAgentAutoCommitAtom: atom(null, (_get, _set, args: unknown) => {
            retries.push(args)
        }),
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
        openAgentVersionHistoryAtom: atom(null, () => undefined),
    }
})

const {statusAtom} = playground as unknown as {statusAtom: PrimitiveAtom<string | null>}

;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const AGENT = "agent-1"

describe("AgentRevisionStatus quiet", () => {
    let container: HTMLDivElement
    let root: Root
    let store: ReturnType<typeof createStore>
    const onUpdate = vi.fn()

    const render = () =>
        act(async () => {
            root.render(
                <Provider store={store}>
                    <AgentRevisionStatus
                        quiet
                        revisionId="revision-4"
                        historyWorkflowId={AGENT}
                        onUpdate={onUpdate}
                    />
                </Provider>,
            )
        })

    beforeEach(() => {
        onUpdate.mockClear()
        retries.length = 0
        store = createStore()
        container = document.createElement("div")
        document.body.appendChild(container)
        root = createRoot(container)
    })
    afterEach(() => {
        act(() => root.unmount())
        container.remove()
    })

    it("shows nothing while the version is saved and the latest", async () => {
        await render()
        expect(container.innerHTML).toBe("")
    })

    it("offers Update to vN for a newer version, and the click moves to it", async () => {
        await render()
        await act(async () => watch.latest?.({workflowId: AGENT, id: "revision-5", version: 5}))
        const pill = [...container.querySelectorAll("button")].find(
            (button) => button.textContent === "Update to v5",
        )
        await act(async () => pill?.click())
        expect(onUpdate).toHaveBeenCalledWith("revision-5")
    })

    it("shows a failed save as the retry, and the retry saves the version", async () => {
        store.set(statusAtom, "error")
        await render()
        const retry = container.querySelector<HTMLElement>("[aria-label='Retry saving changes']")
        expect(retry?.textContent).toContain("Not saved")
        await act(async () => retry?.click())
        expect(retries).toEqual([{revisionId: "revision-4"}])
    })
})
