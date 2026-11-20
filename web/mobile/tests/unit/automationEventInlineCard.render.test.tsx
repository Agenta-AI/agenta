// @vitest-environment jsdom
/**
 * The App and Event card of a new app trigger (F05 f4). The draft owns the app, and it gets the
 * event only once the event detail loaded and the form validated its filters, so "Create
 * automation" cannot save an event that can never run. The select loads every page of events.
 */
import {act, createElement, forwardRef, useImperativeHandle} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

// Stable values, as the real hooks return: a new array or form per render would loop the effects.
const catalog = vi.hoisted(() => ({
    connections: [{id: "conn-1", integration_key: "github", name: "acme"}],
    integrations: [{key: "github", name: "GitHub"}],
    events: {
        events: [{key: "GITHUB_STAR_ADDED_EVENT", name: "Star added"}],
        isLoading: false,
        hasNextPage: false,
        isFetchingNextPage: false,
        requestMore: () => undefined,
    } as Record<string, unknown>,
    form: [{resetFields: () => undefined, getFieldsValue: () => catalog.defaults}],
    /** The form's values before any change: the schema defaults. */
    defaults: {} as Record<string, unknown>,
    event: null as {trigger_config: unknown} | null,
    /** What the form's getValues() answers: the valid values, or a rejection. */
    validate: (() => Promise.resolve({repo: "agenta"})) as () => Promise<Record<string, unknown>>,
}))

vi.mock("@agenta/entities/gatewayTrigger", () => ({
    isConnectionValid: () => true,
    normalizeRepoFilters: (_schema: unknown, values: Record<string, unknown>) => values,
    triggerCatalogDrawerOpenAtom: {},
    triggerEventsSearchAtom: {},
    useTriggerConnectionsQuery: () => ({connections: catalog.connections, isLoading: false}),
    useTriggerCatalogIntegrations: () => ({integrations: catalog.integrations}),
    useTriggerCatalogEvents: () => catalog.events,
    useTriggerEvent: () => ({event: catalog.event, isLoading: false}),
}))
vi.mock("@agenta/entity-ui/gatewayTool", () => ({
    SchemaForm: forwardRef(function SchemaFormStub(_props, ref) {
        useImperativeHandle(ref, () => ({getValues: () => catalog.validate()}))
        return null
    }),
}))
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
    catalog.event = null
    catalog.defaults = {}
    catalog.validate = () => Promise.resolve({repo: "agenta"})
    catalog.events = {...catalog.events, hasNextPage: false, requestMore: () => undefined}
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

/** Renders the card on a picked event and lets the form's validation settle. */
const renderCard = async (onSelectEvent: () => void) => {
    await act(async () => {
        root.render(
            createElement(EventInlineCard, {
                automation: automation("GITHUB_STAR_ADDED_EVENT"),
                onSelectEvent,
            }),
        )
        await Promise.resolve()
    })
}
const blocked = {connectionId: "conn-1", eventKey: "", triggerConfig: undefined}

describe("EventInlineCard", () => {
    it("holds back an event whose required filter is empty", async () => {
        catalog.event = {trigger_config: {required: ["repo"], properties: {repo: {}}}}
        const onSelectEvent = vi.fn()
        await renderCard(onSelectEvent)
        expect(onSelectEvent).toHaveBeenLastCalledWith(blocked)
    })

    it("counts a required filter filled by its default", async () => {
        catalog.event = {trigger_config: {required: ["repo"], properties: {repo: {}}}}
        catalog.defaults = {repo: "agenta"}
        const onSelectEvent = vi.fn()
        await renderCard(onSelectEvent)
        expect(onSelectEvent).toHaveBeenLastCalledWith(
            expect.objectContaining({eventKey: "GITHUB_STAR_ADDED_EVENT"}),
        )
    })

    it("holds back an event whose detail did not load", async () => {
        catalog.event = null
        const onSelectEvent = vi.fn()
        await renderCard(onSelectEvent)
        expect(onSelectEvent).toHaveBeenLastCalledWith(blocked)
    })

    it("holds back an event whose filters fail the form's validation", async () => {
        catalog.event = {trigger_config: {properties: {repo: {}}}}
        catalog.validate = () => Promise.reject(new Error("invalid"))
        const onSelectEvent = vi.fn()
        await renderCard(onSelectEvent)
        expect(onSelectEvent).toHaveBeenLastCalledWith(blocked)
    })

    it("passes the validated filters to the draft", async () => {
        catalog.event = {trigger_config: {properties: {repo: {}}}}
        const onSelectEvent = vi.fn()
        await renderCard(onSelectEvent)
        expect(onSelectEvent).toHaveBeenLastCalledWith({
            connectionId: "conn-1",
            eventKey: "GITHUB_STAR_ADDED_EVENT",
            triggerConfig: {repo: "agenta"},
        })
    })

    it("asks for the next page of events while there is one", async () => {
        const requestMore = vi.fn()
        catalog.events = {...catalog.events, hasNextPage: true, requestMore}
        await renderCard(vi.fn())
        expect(requestMore).toHaveBeenCalled()
    })
})
