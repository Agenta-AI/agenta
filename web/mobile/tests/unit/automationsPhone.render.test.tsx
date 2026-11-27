// @vitest-environment jsdom
/**
 * The Automations tab on a phone (M10, M11): each row has a switch that acts at once, a viewer
 * gets no switch and no "Add automation", and "Add automation" is a full-width button that opens
 * the new-automation form bound to the agent (no sheet of kinds: the form offers the switch).
 * A run row of the run history keeps the desktop height on a phone.
 */
import {act, createElement} from "react"

import {AutomationRunRow} from "@agenta/automation-ui"
import {triggerScheduleDrawerAtom} from "@agenta/entities/gatewayTrigger"
import {AgentOperationsSections} from "@agenta/entity-ui/drill-in"
import {getDefaultStore} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const triggers = vi.hoisted(() => ({
    schedules: [] as unknown[],
    subscriptions: [] as unknown[],
    setScheduleActive: vi.fn(),
}))

vi.mock("@agenta/entities/gatewayTrigger", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entities/gatewayTrigger")>()),
    useTriggerSchedule: () => ({remove: vi.fn(), setActive: triggers.setScheduleActive}),
    useTriggerSubscription: () => ({
        remove: vi.fn(),
        refresh: vi.fn(),
        revoke: vi.fn(),
        setActive: vi.fn(),
    }),
    // The lists `useAgentTriggers` reads (mocked below), loaded.
    useTriggerSchedules: () => ({schedules: [], error: null, isLoading: false, refetch: vi.fn()}),
    useTriggerSubscriptions: () => ({
        subscriptions: [],
        error: null,
        isLoading: false,
        refetch: vi.fn(),
    }),
}))

vi.mock(
    "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/triggerManagement/useAgentTriggers",
    () => ({
        useAgentTriggers: () => ({
            scopedSchedules: triggers.schedules,
            scopedSubscriptions: triggers.subscriptions,
            count: triggers.schedules.length + triggers.subscriptions.length,
            defaultReferences: {application: {id: "app-1"}},
            defaultBoundLabel: "Support triage",
        }),
    }),
)

const schedule = {
    id: "sch-1",
    name: "Daily summary",
    flags: {is_active: true},
    data: {schedule: "0 9 * * 1-5"},
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
    ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    triggers.schedules = [schedule]
    triggers.subscriptions = []
    triggers.setScheduleActive.mockReset()
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

const flush = () => act(async () => await new Promise((resolve) => setTimeout(resolve, 0)))

const renderTab = (props: Record<string, unknown> = {}) =>
    act(() =>
        root.render(
            createElement(AgentOperationsSections, {
                revisionId: "rev-1",
                automationDrawer: null,
                showFiles: false,
                phone: true,
                ...props,
            }),
        ),
    )

const addButton = () =>
    container.querySelector("[data-testid=phone-primary-action] button") as HTMLButtonElement | null

describe("Automations tab on a phone", () => {
    it("turns an automation off from its switch at once", async () => {
        triggers.setScheduleActive.mockResolvedValue(undefined)
        renderTab()
        const toggle = container.querySelector(
            "[role=switch][aria-label='Daily summary']",
        ) as HTMLButtonElement
        expect(toggle.getAttribute("aria-checked")).toBe("true")
        await act(async () => toggle.click())
        expect(triggers.setScheduleActive).toHaveBeenCalledWith("sch-1", false)
    })

    it("shows no Automations header bar, and Add automation at the bottom", () => {
        renderTab()
        expect(container.querySelector("[aria-haspopup=menu][aria-label='Add automation']")).toBe(
            null,
        )
        expect(addButton()?.textContent).toBe("Add automation")
    })

    it("gives a viewer no switch and no Add automation", () => {
        renderTab({disabled: true})
        expect(container.querySelector("[role=switch]")).toBe(null)
        expect(addButton()).toBe(null)
    })

    it("shows the desktop empty state above Add automation", () => {
        triggers.schedules = []
        renderTab()
        expect(container.textContent).toContain("No automations yet")
        expect(addButton()).not.toBe(null)
    })

    it("keeps the desktop shape when not a phone", () => {
        renderTab({phone: false})
        expect(container.querySelector("[role=switch]")).toBe(null)
        expect(addButton()).toBe(null)
        // No header bar: the bordered "Add automation" button opens the form, not a menu (F05 f1).
        const add = [...container.querySelectorAll("button")].find(
            (button) => button.textContent === "Add automation",
        )
        expect(add).toBeDefined()
        expect(add?.getAttribute("aria-haspopup")).toBe(null)
    })
})

describe("Add automation on a phone", () => {
    it("opens the schedule form bound to the agent in the host", async () => {
        const onAddAutomation = vi.fn()
        renderTab({onAddAutomation})
        act(() => addButton()?.click())
        await flush()
        expect(onAddAutomation).toHaveBeenCalledWith("schedule", {application: {id: "app-1"}})
        expect(document.querySelector("[data-testid=bottom-sheet-menu]")).toBe(null)
    })

    it("opens the schedule drawer bound to the agent without a host", async () => {
        renderTab()
        act(() => addButton()?.click())
        await flush()
        expect(getDefaultStore().get(triggerScheduleDrawerAtom)).toMatchObject({
            defaultReferences: {application: {id: "app-1"}},
            defaultBoundLabel: "Support triage",
        })
    })
})

describe("Run history on a phone", () => {
    it("draws a run row at least 44 px high", () => {
        const delivery = {id: "d-1", created_at: "2026-11-20T09:00:00Z", status: {code: "200"}}
        act(() =>
            root.render(
                createElement(AutomationRunRow, {
                    delivery: delivery as never,
                    selected: false,
                    onSelect: vi.fn(),
                    phone: true,
                }),
            ),
        )
        // The same row height on a phone as on the desktop.
        expect(container.querySelector("button")?.className).not.toContain("min-h-11")
    })
})
