// @vitest-environment jsdom
/**
 * The automation view in the panel (F05 f5): Delete sits at the start of the chrome's action row,
 * Discard and Save are the chrome's own through the view form, and the row menu's "Run history"
 * (`openRuns`) puts the run history over the automation once, so the crumb keeps its name.
 */
import {act, createElement} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const editor = vi.hoisted(() => ({
    dirty: false,
    discard: vi.fn(),
    save: vi.fn(),
}))
const viewForm = vi.hoisted(() => ({
    last: null as null | {dirty: boolean; save: () => Promise<unknown>},
}))

vi.mock("@agenta/automation-ui", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    AutomationDetailBody: () => createElement("div", {"data-testid": "detail-body"}),
    AutomationPaneSkeleton: () => null,
    useAutomation: () => ({remove: vi.fn()}),
    useAutomationEditor: () => ({
        loading: false,
        automation: {id: "sch-1", name: "Daily summary", kind: "schedule"},
        preview: {id: "sch-1", name: "Daily summary", kind: "schedule"},
        agentName: "Support triage",
        failureReason: null,
        dirty: editor.dirty,
        saving: false,
        draft: {includeEvent: false},
        discard: editor.discard,
        save: editor.save,
    }),
}))
vi.mock("@agenta/ui/view-stack", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    defineView: (def: unknown) => def,
    useViewForm: (form: {dirty: boolean; save: () => Promise<unknown>}) => {
        viewForm.last = form
    },
    useViewTitle: () => undefined,
    // The chrome's action row stands in as the place the start slot renders.
    ViewFooterStart: ({children}: {children: React.ReactNode}) => children,
}))
vi.mock("@agenta/ui/phone", () => ({useIsPhone: () => false}))
vi.mock("../../src/features/automations/AutomationRunNowButton", () => ({
    AutomationRunNowButton: () => null,
}))
vi.mock("next/dynamic", () => ({default: () => () => null}))

import {automationRunHistoryView} from "../../src/features/automations/automationRunHistoryView"
import AutomationViewBody from "../../src/features/automations/AutomationViewBody"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
    ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    editor.dirty = false
    editor.discard.mockReset()
    editor.save.mockReset()
    viewForm.last = null
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

const params = {automationId: "sch-1", kind: "schedule" as const, workspaceId: "w", projectId: "p"}
const target = {kind: "project" as const}
const navWith = (push = vi.fn().mockResolvedValue(true)) => ({
    depth: 1 as const,
    push,
    replace: vi.fn(),
    back: vi.fn(),
    cancel: vi.fn(),
})
const render = (props: Record<string, unknown>) =>
    act(() => root.render(createElement(AutomationViewBody, {params, target, ...props} as never)))
const button = (text: string) =>
    [...container.querySelectorAll("button")].find(
        (element) => element.textContent === text,
    ) as HTMLButtonElement

describe("Automation view footer", () => {
    it("puts Delete in the action row and hands a clean form to the chrome", () => {
        render({nav: navWith()})
        expect(button("Delete")).toBeTruthy()
        // Discard and Save are the chrome's: they wait for a change of the form.
        expect(viewForm.last?.dirty).toBe(false)
    })

    it("saves through the chrome once the settings changed, and stays open", async () => {
        editor.dirty = true
        editor.save.mockResolvedValue(undefined)
        render({nav: navWith()})
        expect(viewForm.last?.dirty).toBe(true)
        let outcome: unknown
        await act(async () => {
            outcome = await viewForm.last?.save()
        })
        expect(editor.save).toHaveBeenCalledTimes(1)
        expect(outcome).toBe("stay")
    })

    it("asks before Delete", () => {
        render({nav: navWith()})
        expect(document.querySelector("[data-testid=automation-delete-dialog]")).toBeNull()
        act(() => button("Delete").click())
        expect(document.querySelector("[data-testid=automation-delete-dialog]")).not.toBeNull()
    })
})

describe("openRuns", () => {
    it("puts the run history over the automation once", () => {
        const push = vi.fn().mockResolvedValue(true)
        const nav = navWith(push)
        render({nav, params: {...params, openRuns: true}})
        render({nav, params: {...params, openRuns: true}})
        expect(push).toHaveBeenCalledTimes(1)
        expect(push).toHaveBeenCalledWith(
            automationRunHistoryView,
            expect.objectContaining({automationId: "sch-1", kind: "schedule"}),
            target,
        )
    })

    it("opens nothing without it", () => {
        const push = vi.fn()
        render({nav: navWith(push)})
        expect(push).not.toHaveBeenCalled()
    })
})
