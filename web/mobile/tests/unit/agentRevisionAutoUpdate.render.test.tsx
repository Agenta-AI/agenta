// @vitest-environment jsdom
//
// A newer version applies itself when nothing in the session can be lost. The "Update to vN"
// pill stays for the moments it must wait. The status is the real one; the save and version
// state around it are plain atoms the cases drive.
import {act} from "react"

import * as workflow from "@agenta/entities/workflow"
import * as playground from "@agenta/playground/state"
import {AgentRevisionStatus} from "@agenta/playground-ui/agent-page-header"
import {createStore, Provider, type Atom, type PrimitiveAtom} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const watch = vi.hoisted(() => ({
    latest: null as null | ((next: {workflowId: string; id: string; version: number}) => void),
}))

vi.mock("next/dynamic", () => ({default: () => () => null}))
vi.mock("@agenta/ui/ui", () => ({
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
        invalidateAgentCommittedRevisionCache: () => undefined,
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
        openAgentVersionHistoryAtom: atom(null, () => undefined),
    }
})

const {dirtyAtom} = workflow as unknown as {dirtyAtom: PrimitiveAtom<boolean>}
const {statusAtom, scheduledAtom} = playground as unknown as {
    statusAtom: PrimitiveAtom<string | null>
    scheduledAtom: PrimitiveAtom<boolean>
}

;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const AGENT = "agent-1"
const V5 = {workflowId: AGENT, id: "revision-5", version: 5}

describe("AgentRevisionStatus auto-update", () => {
    let container: HTMLDivElement
    let root: Root
    let store: ReturnType<typeof createStore>
    const onUpdate = vi.fn()

    const render = (props: {revisionId?: string; autoUpdate?: boolean} = {}) =>
        act(async () => {
            root.render(
                <Provider store={store}>
                    <AgentRevisionStatus
                        revisionId={props.revisionId ?? "revision-4"}
                        historyWorkflowId={AGENT}
                        onUpdate={onUpdate}
                        autoUpdate={props.autoUpdate}
                    />
                </Provider>,
            )
        })
    const detect = (latest = V5) => act(async () => watch.latest?.(latest))
    const write = (change: () => void) => act(async () => change())
    const pill = () => container.textContent?.includes("Update to v5") ?? false

    beforeEach(() => {
        onUpdate.mockClear()
        store = createStore()
        container = document.createElement("div")
        document.body.appendChild(container)
        root = createRoot(container)
    })
    afterEach(() => {
        act(() => root.unmount())
        container.remove()
    })

    it("moves to the newer version with no click and shows no pill", async () => {
        await render({autoUpdate: true})
        await detect()
        expect(onUpdate.mock.calls).toEqual([["revision-5"]])
        expect(pill()).toBe(false)
    })

    it("does nothing more once the session is on the newer version", async () => {
        await render({autoUpdate: true})
        await detect()
        await render({revisionId: "revision-5", autoUpdate: true})
        await detect()
        expect(onUpdate).toHaveBeenCalledTimes(1)
    })

    it("does nothing when the session is already on the latest version", async () => {
        await render({revisionId: "revision-5", autoUpdate: true})
        await detect()
        expect(onUpdate).not.toHaveBeenCalled()
    })

    it("ignores an answer about another agent", async () => {
        await render({autoUpdate: true})
        await detect({...V5, workflowId: "agent-2"})
        expect(onUpdate).not.toHaveBeenCalled()
    })

    it("keeps the click-to-update pill for a host that does not opt in", async () => {
        await render()
        await detect()
        expect(onUpdate).not.toHaveBeenCalled()
        expect(pill()).toBe(true)
    })

    it("waits for the host, then applies itself", async () => {
        await render({autoUpdate: false})
        await detect()
        expect(onUpdate).not.toHaveBeenCalled()
        expect(pill()).toBe(true)
        await render({autoUpdate: true})
        expect(onUpdate.mock.calls).toEqual([["revision-5"]])
    })

    it.each<[string, () => void, () => void]>([
        ["a draft", () => store.set(dirtyAtom, true), () => store.set(dirtyAtom, false)],
        [
            "an armed save",
            () => store.set(scheduledAtom, true),
            () => store.set(scheduledAtom, false),
        ],
        [
            "a save in flight",
            () => store.set(statusAtom, "saving"),
            () => store.set(statusAtom, null),
        ],
        ["a failed save", () => store.set(statusAtom, "error"), () => store.set(statusAtom, null)],
    ])("holds on %s and applies once it clears", async (_name, hold, clear) => {
        await write(hold)
        await render({autoUpdate: true})
        await detect()
        expect(onUpdate).not.toHaveBeenCalled()
        expect(pill()).toBe(true)
        await write(clear)
        expect(onUpdate.mock.calls).toEqual([["revision-5"]])
    })
})
