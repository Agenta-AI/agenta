// @vitest-environment jsdom
/**
 * The App and Event card of a new app trigger (F05 f4). The draft owns the app, and it gets the
 * event only once the event's required filters are filled, so "Create automation" cannot save an
 * event that can never run.
 */
import {act, createElement} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

// Stable values, as the real hooks return: a new array or form per render would loop the effects.
const catalog = vi.hoisted(() => ({
    connections: [{id: "conn-1", integration_key: "github", name: "acme"}],
    integrations: [{key: "github", name: "GitHub"}],
    events: [{key: "GITHUB_STAR_ADDED_EVENT", name: "Star added"}],
    form: [{resetFields: () => undefined}],
    event: null as {trigger_config: unknown} | null,
}))

vi.mock("@agenta/entities/gatewayTrigger", () => ({
    isConnectionValid: () => true,
    normalizeRepoFilters: (_schema: unknown, values: Record<string, unknown>) => values,
    triggerCatalogDrawerOpenAtom: {},
    triggerEventsSearchAtom: {},
    useTriggerConnectionsQuery: () => ({connections: catalog.connections, isLoading: false}),
    useTriggerCatalogIntegrations: () => ({integrations: catalog.integrations}),
    useTriggerCatalogEvents: () => ({events: catalog.events}),
    useTriggerEvent: () => ({event: catalog.event, isLoading: false}),
}))
vi.mock("@agenta/entity-ui/gatewayTool", () => ({SchemaForm: () => null}))
vi.mock("@agenta/entity-ui/gatewayTrigger", () => ({
    useSchemaFormInstance: () => catalog.form,
}))
vi.mock("jotai", async (importOriginal) => ({
    ...(await importOriginal<typeof import("jotai")>()),
    useSetAtom: () => () => undefined,
}))

import {EventInlineCard} from "../../../packages/agenta-automation-ui/src/pickers/EventPickerPanel"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
    ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

const automation = (eventKey: string | null) =>
    ({
        id: "",
        kind: "event",
        name: "",
        description: "",
        agentId: null,
        isActive: true,
        cron: null,
        eventKey,
        connectionId: null,
        updatedAt: null,
        raw: {},
    }) as never

describe("EventInlineCard", () => {
    it("binds the first connected app and holds back an event with an empty required filter", () => {
        catalog.event = {trigger_config: {required: ["repo"], properties: {repo: {type: "string"}}}}
        const onSelectEvent = vi.fn()
        act(() =>
            root.render(
                createElement(EventInlineCard, {
                    automation: automation("GITHUB_STAR_ADDED_EVENT"),
                    onSelectEvent,
                }),
            ),
        )
        expect(onSelectEvent).toHaveBeenLastCalledWith({
            connectionId: "conn-1",
            eventKey: "",
            triggerConfig: undefined,
        })
    })

    it("passes an event with no required filter to the draft", () => {
        catalog.event = {trigger_config: {properties: {repo: {type: "string"}}}}
        const onSelectEvent = vi.fn()
        act(() =>
            root.render(
                createElement(EventInlineCard, {
                    automation: automation("GITHUB_STAR_ADDED_EVENT"),
                    onSelectEvent,
                }),
            ),
        )
        expect(onSelectEvent).toHaveBeenLastCalledWith(
            expect.objectContaining({connectionId: "conn-1", eventKey: "GITHUB_STAR_ADDED_EVENT"}),
        )
    })
})
