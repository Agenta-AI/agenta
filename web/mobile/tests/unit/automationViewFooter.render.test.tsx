// @vitest-environment jsdom
/**
 * The automation view in the panel (F05 f5): its own footer holds Delete, Discard and Save, and
 * the row menu's "Run history" (`openRuns`) puts the run history over the automation once, so the
 * crumb keeps the automation's name.
 */
import {act, createElement} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const editor = vi.hoisted(() => ({
    dirty: false,
    discard: vi.fn(),
    save: vi.fn(),
}))

vi.mock("@agenta/automation-ui", () => ({
    AutomationDetailBody: () => createElement("div", {"data-testid": "detail-body"}),
    AutomationDetailSkeleton: () => null,
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
vi.mock("@agenta/entity-ui/drill-in", () => ({
    AutomationDeleteDialog: ({open}: {open: boolean}) =>
        open ? createElement("div", {"data-testid": "delete-dialog"}) : null,
}))
vi.mock("@agenta/ui/view-stack", () => ({
    defineView: (def: unknown) => def,
    useViewForm: () => undefined,
    useViewTitle: () => undefined,
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
    it("holds Delete, Discard and Save; Discard and Save wait for a change", () => {
        render({nav: navWith()})
        expect(button("Delete")).toBeTruthy()
        expect(button("Discard").disabled).toBe(true)
        expect(button("Save").disabled).toBe(true)
    })

    it("saves and discards the settings once they changed", () => {
        editor.dirty = true
        render({nav: navWith()})
        act(() => button("Save").click())
        act(() => button("Discard").click())
        expect(editor.save).toHaveBeenCalledTimes(1)
        expect(editor.discard).toHaveBeenCalledTimes(1)
    })

    it("asks before Delete", () => {
        render({nav: navWith()})
        expect(container.querySelector("[data-testid=delete-dialog]")).toBeNull()
        act(() => button("Delete").click())
        expect(container.querySelector("[data-testid=delete-dialog]")).not.toBeNull()
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
