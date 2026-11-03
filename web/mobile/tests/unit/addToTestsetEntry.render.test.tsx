// @vitest-environment jsdom
// The two ways into the add-to-test-set sheet: the traces toolbar Add menu and the trace drawer
// button. Both hide behind the developer view and the `edit_testsets` right, and the sheet itself
// is a lazy chunk, stubbed here to record what it is opened with.
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
    sheets: [] as {spanIds: readonly string[]}[],
}))

vi.mock("@/features/developer/developerViewAccess", () => ({
    useDeveloperViewEnabled: (id: string) =>
        id === "observability-actions" ? fixture.viewEnabled : false,
}))
vi.mock("@/features/context/useProjectPermission", () => ({
    useProjectPermission: (projectId: string, action: string) => {
        fixture.permissionCalls.push([projectId, action])
        return Boolean(projectId) && action === "edit_testsets" && fixture.canEdit
    },
}))
vi.mock("next/dynamic", () => ({
    default: () =>
        function SheetStub(props: {spanIds: readonly string[]; onClose: () => void}) {
            fixture.sheets.push(props)
            return (
                <button type="button" data-testid="sheet" onClick={props.onClose}>
                    {props.spanIds.join(",")}
                </button>
            )
        },
}))

import {DEVELOPER_VIEWS} from "@/features/developer/developerViews"
import {AddToTestsetDrawerButton} from "@/features/observability/addToTestset/AddToTestsetDrawerButton"
import {useAddToTestsetAction} from "@/features/observability/addToTestset/useAddToTestsetAction"

let root: Root
let host: HTMLElement
let action: ReturnType<typeof useAddToTestsetAction>

const ActionProbe = ({selected}: {selected: string[]}) => {
    action = useAddToTestsetAction("project-1", selected)
    return <>{action.sheet}</>
}

const render = async (node: ReactNode) => {
    await act(async () => root.render(node))
}
const sheet = () => host.querySelector<HTMLButtonElement>("[data-testid=sheet]")

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

describe("add to test set entry points", () => {
    it("The view is registered as a hidden feature gate", () => {
        const view = DEVELOPER_VIEWS.find((item) => item.id === "observability-actions")
        expect(view?.stage).toBe("hidden")
        expect(view?.routes).toBeUndefined()
    })

    it("The toolbar Add menu offers Add to testset only when rows are selected", async () => {
        await render(<ActionProbe selected={[]} />)
        expect(action.testsetAction?.disabled).toBe(true)

        await render(<ActionProbe selected={["span-1"]} />)
        expect(action.testsetAction?.disabled).toBe(false)
    })

    it("Add to testset passes the selected span ids to the sheet", async () => {
        await render(<ActionProbe selected={["span-1", "span-2"]} />)
        expect(sheet()).toBeNull()

        await act(async () => action.testsetAction?.onSelect())
        expect(sheet()?.textContent).toBe("span-1,span-2")

        // Closing unmounts the sheet, so its state goes with it.
        await act(async () => sheet()?.click())
        expect(sheet()).toBeNull()
    })

    it("The trace drawer button opens the sheet for the active span", async () => {
        await render(<AddToTestsetDrawerButton label="Add to testset" spanIds={["span-7"]} />)
        const button = host.querySelector("button")
        expect(button?.textContent).toBe("Add to testset")
        expect(sheet()).toBeNull()

        await act(async () => button?.click())
        expect(sheet()?.textContent).toBe("span-7")
    })

    it("The trace drawer button is disabled without a span", async () => {
        await render(<AddToTestsetDrawerButton label="Add to testset" spanIds={[]} disabled />)
        expect(host.querySelector("button")?.disabled).toBe(true)
    })

    it("Both entry points are hidden while the view is hidden", async () => {
        fixture.viewEnabled = false
        await render(
            <>
                <ActionProbe selected={["span-1"]} />
                <AddToTestsetDrawerButton label="Add to testset" spanIds={["span-7"]} />
            </>,
        )
        expect(action.testsetAction).toBeUndefined()
        expect(host.querySelector("button")).toBeNull()
        // A hidden view asks the server nothing.
        expect(fixture.permissionCalls.every(([projectId]) => projectId === "")).toBe(true)
    })

    it("Both entry points are hidden without edit_testsets", async () => {
        fixture.canEdit = false
        await render(
            <>
                <ActionProbe selected={["span-1"]} />
                <AddToTestsetDrawerButton label="Add to testset" spanIds={["span-7"]} />
            </>,
        )
        expect(action.testsetAction).toBeUndefined()
        expect(host.querySelector("button")).toBeNull()
    })
})
