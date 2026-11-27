// @vitest-environment jsdom
/**
 * The Automations tab (F05 f1): "Scheduled triggers" first, "App triggers" second, a group with
 * no automation does not show, and "Delete" asks first with "Delete this automation?" (F06 f4).
 * A failed delete keeps the dialog and the automation. A list that failed to load says so, with
 * Retry, rather than "No automations yet".
 */
import {act, createElement} from "react"

import {TriggerManagementSection} from "@agenta/entity-ui/drill-in"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const triggers = vi.hoisted(() => ({
    schedules: [] as unknown[],
    subscriptions: [] as unknown[],
    removeSchedule: vi.fn(),
    listError: null as Error | null,
    listLoading: false,
    refetch: vi.fn(),
}))

vi.mock("@agenta/entities/gatewayTrigger", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entities/gatewayTrigger")>()),
    useTriggerSchedule: () => ({remove: triggers.removeSchedule, setActive: vi.fn()}),
    useTriggerSchedules: () => ({
        schedules: [],
        error: triggers.listError,
        isLoading: triggers.listLoading,
        refetch: triggers.refetch,
    }),
    useTriggerSubscriptions: () => ({
        subscriptions: [],
        error: null,
        isLoading: triggers.listLoading,
        refetch: vi.fn(),
    }),
    useTriggerSubscription: () => ({
        remove: vi.fn(),
        refresh: vi.fn(),
        revoke: vi.fn(),
        setActive: vi.fn(),
    }),
}))

vi.mock(
    "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/triggerManagement/useAgentTriggers",
    () => ({
        useAgentTriggers: () => ({
            scopedSchedules: triggers.schedules,
            scopedSubscriptions: triggers.subscriptions,
            count: triggers.schedules.length + triggers.subscriptions.length,
            defaultReferences: {},
            defaultBoundLabel: "Support triage",
        }),
    }),
)
vi.mock(
    "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/triggerManagement/AppTriggerProviderGroups",
    () => ({
        AppTriggerProviderGroups: ({
            scopedSubscriptions,
        }: {
            scopedSubscriptions: {name: string}[]
        }) =>
            createElement(
                "div",
                {"data-testid": "app-triggers"},
                scopedSubscriptions.map((s) => s.name).join(","),
            ),
    }),
)

const schedule = {id: "sch-1", name: "Daily summary", flags: {is_active: true}, data: {}}
const subscription = {id: "sub-1", name: "New Zendesk ticket", flags: {is_active: true}, data: {}}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
    ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    // The menu's tooltip trigger measures itself; jsdom has no ResizeObserver.
    vi.stubGlobal(
        "ResizeObserver",
        class {
            observe() {}
            unobserve() {}
            disconnect() {}
        },
    )
    triggers.schedules = []
    triggers.subscriptions = []
    triggers.removeSchedule.mockReset()
    triggers.listError = null
    triggers.listLoading = false
    triggers.refetch.mockReset()
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
})

const renderSection = (props: Record<string, unknown> = {}) =>
    act(() =>
        root.render(
            createElement(TriggerManagementSection, {
                entityId: "rev-1",
                automationDrawer: null,
                ...props,
            }),
        ),
    )

const flush = () => act(async () => await new Promise((resolve) => setTimeout(resolve, 0)))

/** Opens the first row's "⋯" menu and returns its items once they render. */
const openRowMenu = async () => {
    const trigger = container.querySelector("[aria-haspopup=menu]") as HTMLButtonElement
    act(() => {
        trigger.focus()
        trigger.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}))
    })
    await flush()
    return [...document.querySelectorAll("[role=menuitem]")] as HTMLElement[]
}
const item = (items: HTMLElement[], text: string) =>
    items.find((element) => element.textContent === text) as HTMLElement
const headings = () => [...container.querySelectorAll("h3")].map((h) => h.textContent)

describe("Automations tab list", () => {
    it("shows Scheduled triggers before App triggers", () => {
        triggers.schedules = [schedule]
        triggers.subscriptions = [subscription]
        renderSection()
        expect(headings()).toEqual(["Scheduled triggers", "App triggers"])
    })

    it("hides a group with no automation", () => {
        triggers.subscriptions = [subscription]
        renderSection()
        expect(headings()).toEqual(["App triggers"])
    })

    it("says No automations yet with none", () => {
        renderSection()
        expect(container.textContent).toContain("No automations yet")
    })

    it("says nothing about an empty list while it loads", () => {
        triggers.listLoading = true
        renderSection()
        expect(container.textContent).not.toContain("No automations yet")
    })

    it("shows the load error with Retry when the list fails to load", () => {
        triggers.listError = new Error("502")
        renderSection()
        expect(container.textContent).toContain("Could not load automations")
        expect(container.textContent).not.toContain("No automations yet")
        const retry = [...container.querySelectorAll("button")].find(
            (button) => button.textContent === "Retry",
        ) as HTMLButtonElement
        act(() => retry.click())
        expect(triggers.refetch).toHaveBeenCalledTimes(1)
    })
})

describe("Schedule row", () => {
    it("says Weekdays for a Monday to Friday cron, and names its menu after the automation", () => {
        triggers.schedules = [{...schedule, data: {schedule: "0 9 * * 1-5"}}]
        renderSection()
        expect(container.textContent).toContain("Weekdays at 09:00 UTC")
        expect(container.textContent).not.toContain("Monday")
        const menu = container.querySelector("[aria-haspopup=menu]")
        expect(menu?.getAttribute("aria-label")).toBe("More actions for Daily summary")
    })
})

describe("Row menu", () => {
    it("deletes the row's automation only after the question", async () => {
        triggers.schedules = [schedule]
        triggers.removeSchedule.mockResolvedValue(undefined)
        renderSection()
        const items = await openRowMenu()
        act(() => item(items, "Delete").click())
        // The dialog mounts after the menu closes.
        await flush()
        expect(triggers.removeSchedule).not.toHaveBeenCalled()
        const dialog = document.querySelector("[data-testid=automation-delete-dialog]")
        expect(dialog?.textContent).toContain("“Daily summary” stops running")
        const confirm = [...(dialog?.querySelectorAll("button") ?? [])].find(
            (b) => b.textContent === "Delete",
        ) as HTMLButtonElement
        await act(async () => confirm.click())
        expect(triggers.removeSchedule).toHaveBeenCalledWith("sch-1")
    })

    it("opens the automation in the host from Edit", async () => {
        triggers.schedules = [schedule]
        const onOpenAutomation = vi.fn()
        renderSection({onOpenAutomation, onOpenRunHistory: vi.fn()})
        const items = await openRowMenu()
        expect(items.map((element) => element.textContent)).toEqual([
            "Run now",
            "Run history",
            "Edit",
            "Deactivate",
            "Delete",
        ])
        act(() => item(items, "Edit").click())
        expect(onOpenAutomation).toHaveBeenCalledWith({kind: "schedule", id: "sch-1"})
    })

    it("offers a viewer Run history only", async () => {
        triggers.schedules = [schedule]
        renderSection({disabled: true, onOpenRunHistory: vi.fn()})
        expect((await openRowMenu()).map((element) => element.textContent)).toEqual(["Run history"])
    })
})

describe("Delete this automation?", () => {
    it("deletes only after Delete, and keeps the dialog when the delete fails", async () => {
        triggers.schedules = [schedule]
        triggers.removeSchedule.mockRejectedValueOnce(new Error("boom"))
        vi.spyOn(console, "error").mockImplementation(() => undefined)
        renderSection()
        const menu = await openRowMenu()
        act(() => item(menu, "Delete").click())
        await flush()
        const dialog = document.querySelector("[data-testid=automation-delete-dialog]")
        expect(dialog?.textContent).toContain("Delete this automation?")
        expect(dialog?.textContent).toContain(
            "“Daily summary” stops running and leaves your list. Its past runs stay in your history.",
        )
        expect(triggers.removeSchedule).not.toHaveBeenCalled()
        const deleteButton = [...(dialog?.querySelectorAll("button") ?? [])].find(
            (b) => b.textContent === "Delete",
        ) as HTMLButtonElement
        await act(async () => deleteButton.click())
        expect(triggers.removeSchedule).toHaveBeenCalledTimes(1)
        expect(document.querySelector("[data-testid=automation-delete-dialog]")).not.toBeNull()
        expect(document.querySelector("[role=alert]")?.textContent).toBe(
            "Couldn't delete this automation. Try again.",
        )
    })
})
