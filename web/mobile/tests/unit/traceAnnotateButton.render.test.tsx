// @vitest-environment jsdom
// The trace drawer's Annotate button: it hides behind the trace actions view and the
// `edit_spans` right, stays disabled without a span, and mounts the lazy sheet on the first click.
import {act, type ReactNode} from "react"

import {projectIdAtom} from "@agenta/shared/state"
import {getDefaultStore} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const fixture = vi.hoisted(() => ({
    viewEnabled: true as boolean | null,
    canEdit: true,
    permissionCalls: [] as [string, string][],
    sheets: [] as {traceId?: string; spanId?: string; annotations: unknown[]}[],
}))

vi.mock("@/features/developer/developerViewAccess", () => ({
    useDeveloperViewEnabled: (id: string) =>
        id === "observability-actions" ? fixture.viewEnabled : false,
}))
vi.mock("@/features/context/useProjectPermission", () => ({
    useProjectPermission: (projectId: string, action: string) => {
        fixture.permissionCalls.push([projectId, action])
        return Boolean(projectId) && action === "edit_spans" && fixture.canEdit
    },
}))
vi.mock("next/dynamic", () => ({
    default: () =>
        function SheetStub(props: {
            traceId?: string
            spanId?: string
            annotations: unknown[]
            onClose: () => void
        }) {
            fixture.sheets.push(props)
            return (
                <button type="button" data-testid="sheet" onClick={props.onClose}>
                    {props.spanId}
                </button>
            )
        },
}))

import {TraceAnnotateButton} from "@/features/observability/annotate/TraceAnnotateButton"

let root: Root
let host: HTMLElement

const render = async (node: ReactNode) => {
    await act(async () => root.render(node))
}
const annotateButton = () =>
    Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Annotate")
const sheet = () => host.querySelector<HTMLButtonElement>("[data-testid=sheet]")

const SLOT_PROPS = {
    label: "Annotate",
    size: "small",
    data: [{trace_id: "ann-1"}],
    traceSpanIds: {traceId: "trace-1", spanId: "span-1"},
    queryKey: "trace-drawer-annotations",
}

beforeEach(() => {
    fixture.viewEnabled = true
    fixture.canEdit = true
    fixture.permissionCalls = []
    fixture.sheets = []
    getDefaultStore().set(projectIdAtom, "project-1")
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    getDefaultStore().set(projectIdAtom, null)
})

describe("trace annotate button", () => {
    it("Annotate is hidden without edit_spans", async () => {
        fixture.canEdit = false
        await render(<TraceAnnotateButton {...SLOT_PROPS} />)
        expect(annotateButton()).toBeUndefined()
        expect(fixture.permissionCalls).toContainEqual(["project-1", "edit_spans"])
    })

    it("Annotate is hidden and asks no permission while the view is off", async () => {
        fixture.viewEnabled = false
        await render(<TraceAnnotateButton {...SLOT_PROPS} />)
        expect(annotateButton()).toBeUndefined()
        expect(fixture.permissionCalls.every(([projectId]) => projectId === "")).toBe(true)
    })

    it("Annotate is disabled when no span is selected", async () => {
        await render(<TraceAnnotateButton {...SLOT_PROPS} traceSpanIds={{traceId: "trace-1"}} />)
        expect(annotateButton()?.disabled).toBe(true)
    })

    it("The sheet mounts on the first click with the active span and its annotations", async () => {
        await render(<TraceAnnotateButton {...SLOT_PROPS} />)
        expect(sheet()).toBeNull()

        await act(async () => annotateButton()?.click())

        expect(sheet()?.textContent).toBe("span-1")
        expect(fixture.sheets.at(-1)).toMatchObject({
            traceId: "trace-1",
            spanId: "span-1",
            annotations: [{trace_id: "ann-1"}],
        })
        await act(async () => sheet()?.click())
        expect(sheet()).toBeNull()
    })
})
