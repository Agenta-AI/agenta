/**
 * The read-only revision drawer: its shell, header and load states (A1 to A9, A21 to A24).
 *
 * The revision query is replaced by a plain atom per id, so each test sets the state it needs
 * (pending, settled with data, settled empty, failed). The config pane and the details column
 * have their own tests; here they are stubs.
 */
import {act, type ReactNode} from "react"

import {atom, createStore, Provider, type PrimitiveAtom} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

interface QueryState {
    data: unknown
    isPending: boolean
    isError: boolean
    refetch: () => void
}

const {queryAtoms} = vi.hoisted(() => ({queryAtoms: new Map<string, unknown>()}))

vi.mock("@agenta/entities/workflow", () => ({
    workflowMolecule: {atoms: {query: (id: string) => queryAtoms.get(id)}},
}))
vi.mock("../../src/variant/RevisionDrawer/RevisionConfigView", () => ({
    RevisionConfigView: () => <div data-testid="config" />,
}))
vi.mock("../../src/variant/RevisionDrawer/RevisionDetails", () => ({
    RevisionDetails: () => <div data-testid="details" />,
}))

import {RevisionDrawer} from "../../src/variant/RevisionDrawer/RevisionDrawer"
import type {RevisionDrawerProps} from "../../src/variant/RevisionDrawer/types"

let host: HTMLDivElement
let root: Root
let store: ReturnType<typeof createStore>

const setQuery = (id: string, state: Partial<QueryState>) => {
    const value: QueryState = {
        data: null,
        isPending: false,
        isError: false,
        refetch: () => undefined,
        ...state,
    }
    const existing = queryAtoms.get(id) as PrimitiveAtom<QueryState> | undefined
    if (existing) store.set(existing, value)
    else queryAtoms.set(id, atom(value))
}

const render = async (props: Partial<RevisionDrawerProps> = {}) => {
    const all: RevisionDrawerProps = {
        revisionId: "rev-1",
        kind: "variant",
        onClose: () => undefined,
        ...props,
    }
    const wrap = (node: ReactNode) => <Provider store={store}>{node}</Provider>
    await act(async () => {
        root.render(wrap(<RevisionDrawer {...all} />))
    })
}

const button = (label: string) =>
    document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
const dialog = () => document.querySelector("[role=dialog]")

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    queryAtoms.clear()
    store = createStore()
    setQuery("rev-1", {data: {id: "rev-1"}})
    setQuery("rev-2", {data: {id: "rev-2"}})
    setQuery("rev-3", {data: {id: "rev-3"}})
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    document.body.innerHTML = ""
})

describe("RevisionDrawer", () => {
    it("The drawer is closed when no revision id is given", async () => {
        await render({revisionId: null})
        expect(dialog()).toBeNull()
    })

    it("The title follows the kind", async () => {
        for (const [kind, title] of [
            ["variant", "Workflow Revision"],
            ["deployment", "Deployment"],
            ["evaluator", "Evaluator"],
        ] as const) {
            await render({kind})
            expect(document.querySelector("[data-slot=sheet-title]")?.textContent).toBe(title)
        }
    })

    it("Prev and next show only with two or more navigation ids", async () => {
        await render({navigationIds: ["rev-1"]})
        expect(button("Previous revision")).toBeNull()
        expect(button("Next revision")).toBeNull()
        await render({navigationIds: ["rev-1", "rev-2"]})
        expect(button("Previous revision")).not.toBeNull()
        expect(button("Next revision")).not.toBeNull()
    })

    it("Prev is disabled on the first id and next on the last", async () => {
        const navigationIds = ["rev-1", "rev-2", "rev-3"]
        await render({revisionId: "rev-1", navigationIds})
        expect(button("Previous revision")?.disabled).toBe(true)
        expect(button("Next revision")?.disabled).toBe(false)
        await render({revisionId: "rev-3", navigationIds})
        expect(button("Previous revision")?.disabled).toBe(false)
        expect(button("Next revision")?.disabled).toBe(true)
    })

    it("Clicking next reports the next id", async () => {
        const onNavigate = vi.fn()
        await render({revisionId: "rev-2", navigationIds: ["rev-1", "rev-2", "rev-3"], onNavigate})
        await act(async () => button("Next revision")?.click())
        expect(onNavigate).toHaveBeenCalledWith("rev-3")
        await act(async () => button("Previous revision")?.click())
        expect(onNavigate).toHaveBeenLastCalledWith("rev-1")
    })

    it("Prev and next stay usable while the revision loads", async () => {
        setQuery("rev-2", {data: null, isPending: true})
        const onNavigate = vi.fn()
        await render({revisionId: "rev-2", navigationIds: ["rev-1", "rev-2"], onNavigate})
        expect(document.querySelector("[data-testid=revision-drawer-loading]")).not.toBeNull()
        await act(async () => button("Previous revision")?.click())
        expect(onNavigate).toHaveBeenCalledWith("rev-1")
    })

    it("Escape and the close button call onClose", async () => {
        const onClose = vi.fn()
        await render({onClose})
        await act(async () => button("Close")?.click())
        expect(onClose).toHaveBeenCalledTimes(1)
        await act(async () => {
            dialog()?.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}))
        })
        expect(onClose).toHaveBeenCalledTimes(2)
    })

    it("The actions slot renders what the host passes", async () => {
        await render({actions: <button type="button">Deploy</button>})
        const header = document.querySelector("[data-slot=sheet-header]")
        expect(header?.textContent).toContain("Deploy")
    })

    it("A settled revision shows the config pane and the details", async () => {
        await render()
        await act(async () => undefined)
        expect(document.querySelector("[data-testid=config]")).not.toBeNull()
        expect(document.querySelector("[data-testid=details]")).not.toBeNull()
    })

    it("A revision that settles empty shows the not available text", async () => {
        setQuery("rev-1", {data: null})
        await render()
        expect(dialog()?.textContent).toContain("This revision is no longer available.")
        expect(document.querySelector("[data-testid=config]")).toBeNull()
    })

    it("A failed revision load shows a retry", async () => {
        const refetch = vi.fn()
        setQuery("rev-1", {data: null, isError: true, refetch})
        await render()
        expect(dialog()?.textContent).toContain("Could not load this revision")
        const retry = [...document.querySelectorAll("button")].find(
            (b) => b.textContent === "Try again",
        )
        await act(async () => retry?.click())
        expect(refetch).toHaveBeenCalledTimes(1)
    })
})
