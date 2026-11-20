import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    normalizeRepoFilters,
    triggerCatalogDrawerOpenAtom,
    triggerEventsSearchAtom,
    useTriggerCatalogEvents,
    useTriggerCatalogIntegrations,
    useTriggerConnectionsQuery,
    useTriggerEvent,
    type TriggerSubscription,
} from "@agenta/entities/gatewayTrigger"
import {SchemaForm, type SchemaFormHandle} from "@agenta/entity-ui/gatewayTool"
import {useSchemaFormInstance} from "@agenta/entity-ui/gatewayTrigger"
import {useT} from "@agenta/i18n"
import automationsEditorCatalog from "@agenta/i18n/catalogs/automations.editor"
import {
    Button,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    SkeletonBlock,
} from "@agenta/ui/ui"
import {ArrowLeft} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"

import type {Automation} from "../automationModel"
import {EventPickerNoApps} from "../states/EventPickerStates"

import {appLabel, connectedApps, eventLabel, type ConnectedApp} from "./connectedApps"
import {EventAppRail} from "./EventAppRail"
import {EventList} from "./EventList"
import {usePickerIsWide} from "./PickerOverlay"

/**
 * The workspace's connected apps, one per integration, named by the catalog's display name
 * ("Google Calendar", not "Googlecalendar"), so every label downstream reads the same.
 */
function useConnectedApps() {
    const {connections, isLoading: connectionsLoading} = useTriggerConnectionsQuery()
    const {integrations} = useTriggerCatalogIntegrations()
    const catalogNames = useMemo(
        () => new Map(integrations.map((integration) => [integration.key, integration.name])),
        [integrations],
    )
    const apps = useMemo(
        () => connectedApps(connections, catalogNames),
        [catalogNames, connections],
    )
    return {connections, connectionsLoading, catalogNames, apps}
}

/** What Done hands back in a draft's "not yet saved" mode. */
export interface EventSelection {
    connectionId: string
    eventKey: string
    triggerConfig: Record<string, unknown> | undefined
}

/**
 * Which event runs this automation — the panel only, with no overlay of its own, so the
 * "Runs when" control can put it under the kind chips next to the schedule builder.
 *
 * Browse is the connected apps and their events, and nothing else: an automation can only watch
 * an app this workspace has already connected, so the marketplace catalog (descriptions,
 * categories, action counts) answers a question nobody asked here. Connecting a NEW app is that
 * other question, and it opens the real integration drawer — mounted at screen level, since a
 * drawer owned by this popover dies with it.
 *
 * The filters step is not reimplemented either: it is the event's own `trigger_config` through
 * the shared `SchemaForm`, which paints the required fields inline and hides the optional ones
 * behind its own disclosure. It takes over the right pane only — the search field, the app rail
 * and "Connect another app" stay where they were, so picking a different app is still one click.
 *
 * The selection leaves on **Done**, not on pick: an event whose required filters are empty
 * (GitHub's owner/repo) is a subscription that can never run, so handing back the moment the event
 * is chosen would report a half-made choice as the choice. Nothing here writes to the backend —
 * the host holds the pick with the rest of its draft until it is saved.
 */
export const EventPickerPanel = ({
    automation,
    open,
    onClose,
    onSelectEvent,
}: {
    automation: Automation
    /** Whether the surface holding this panel is open — the prefill restarts from saved on each. */
    open: boolean
    onClose: () => void
    /** Where the picked event goes — the host's draft, never a save from here. */
    onSelectEvent: (selection: EventSelection) => void
}) => {
    const t = useT(automationsEditorCatalog)
    const {connections, connectionsLoading, catalogNames, apps} = useConnectedApps()

    const [connectionId, setConnectionId] = useState(automation.connectionId ?? undefined)
    const [eventKey, setEventKey] = useState(automation.eventKey ?? "")
    const [browsing, setBrowsing] = useState(!automation.eventKey)
    const [values, setValues] = useState<Record<string, unknown>>({})
    const [saving, setSaving] = useState(false)
    const [search, setSearch] = useState("")
    /** Only what the user clicked in the rail — the default is derived, so it can arrive late. */
    const [railKey, setRailKey] = useState<string | undefined>(undefined)
    // A phone has no room for the rail beside the list, so the apps become a step of their own:
    // apps → events → filters, each full width, with a way back at the top of the next.
    const isWide = usePickerIsWide()
    const [onApps, setOnApps] = useState(!automation.eventKey)

    const openCatalogDrawer = useSetAtom(triggerCatalogDrawerOpenAtom)
    // The catalog hooks read one shared search atom — the panel owns it while it is open.
    const setEventsSearch = useSetAtom(triggerEventsSearchAtom)

    // SchemaForm keeps its state in a host-owned form instance — the only way to prefill the
    // stored filters, and the only way to read them back validated.
    const [configForm] = useSchemaFormInstance()
    const formRef = useRef<SchemaFormHandle>(null)

    const storedConfig = useMemo(
        () =>
            ((automation.raw as TriggerSubscription).data?.trigger_config ?? {}) as Record<
                string,
                unknown
            >,
        [automation.raw],
    )

    const connection = useMemo(
        () => connections.find((candidate) => candidate.id === connectionId),
        [connections, connectionId],
    )
    const {event, isLoading: eventLoading} = useTriggerEvent(
        connection?.integration_key ?? "",
        eventKey,
    )
    const schema = (event?.trigger_config ?? null) as Record<string, unknown> | null

    const activeApp = useMemo<ConnectedApp | undefined>(() => {
        const key = railKey ?? connection?.integration_key
        return apps.find((app) => app.integrationKey === key) ?? apps[0]
    }, [apps, connection?.integration_key, railKey])

    const query = search.trim()

    // The server gets the query too, debounced, because the atom is a query key. It only ADDS
    // rows: the list applies the same words itself, so what is on screen never waits on this.
    useEffect(() => {
        const timer = window.setTimeout(() => setEventsSearch(query), 200)
        return () => window.clearTimeout(timer)
    }, [query, setEventsSearch])

    // Leaving the panel must not leave the catalog filtered for whoever opens it next.
    useEffect(() => () => setEventsSearch(""), [setEventsSearch])

    // Reopening restarts from the host's current selection, not from an abandoned edit: a
    // half-picked event must not survive as the next session's starting point.
    useEffect(() => {
        if (!open) return
        setConnectionId(automation.connectionId ?? undefined)
        setEventKey(automation.eventKey ?? "")
        setBrowsing(!automation.eventKey)
        setSaving(false)
        setSearch("")
        setRailKey(undefined)
        setOnApps(!automation.eventKey)
    }, [open, automation.connectionId, automation.eventKey])

    // Filters belong to the event's own schema, so a different event starts from empty; the
    // bound one starts from what is stored, or Done would silently clear it.
    useEffect(() => {
        if (!open) return
        const initial = eventKey && eventKey === automation.eventKey ? storedConfig : {}
        configForm.resetFields()
        configForm.setFieldsValue(initial)
        setValues(initial)
    }, [open, eventKey, automation.eventKey, storedConfig, configForm])

    const showFilters = !browsing

    const missing = useMemo(() => requiredGaps(schema, values), [schema, values])
    // The schema is what says which filters are required, so Done stays shut until it lands:
    // in flight, `schema` is null, `missing` is empty, and an unfilled event would look ready.
    const ready = Boolean(connectionId && eventKey) && !eventLoading && missing.length === 0

    const onPick = useCallback((pickedConnectionId: string, pickedEventKey: string) => {
        setConnectionId(pickedConnectionId)
        setEventKey(pickedEventKey)
        setBrowsing(false)
        setSearch("")
    }, [])

    // The rail never leaves, so it is also the way out of an event's filters: picking an app is
    // asking for its events.
    const onSelectApp = useCallback(
        (app: ConnectedApp) => {
            setRailKey(app.integrationKey)
            setBrowsing(true)
            setOnApps(false)
            // The search belongs to the app it was typed for; carrying it across would answer a
            // question about GitHub with an empty Slack list. Cleared everywhere at once, or the
            // new app's first query would still carry the old app's words.
            setSearch("")
            setEventsSearch("")
        },
        [setEventsSearch],
    )

    // The drawer lives on the screen, so the picker gets out of its way first — on a phone this
    // panel is a modal sheet, and a sheet over the drawer is a drawer nobody can reach.
    const onConnectAnother = useCallback(() => {
        onClose()
        openCatalogDrawer(true)
    }, [onClose, openCatalogDrawer])

    const onDone = useCallback(async () => {
        if (!connectionId || !eventKey) return
        setSaving(true)
        try {
            // Throws on a failed rule — SchemaForm has already painted the inline errors, so
            // there is nothing to report here beyond staying open.
            const values = await formRef.current?.getValues()
            const triggerConfig = values ? normalizeRepoFilters(schema, values) : undefined
            onSelectEvent({connectionId, eventKey, triggerConfig})
            onClose()
        } catch {
            // Validation failed: the overlay stays open with the edit intact.
        } finally {
            setSaving(false)
        }
    }, [connectionId, eventKey, onClose, onSelectEvent, schema])

    const boundAppLabel = connection
        ? appLabel(connection, catalogNames.get(connection.integration_key))
        : (activeApp?.label ?? null)

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {/* Each pane scrolls on its own: a long rail and a long event list are two lists,
                and one scroller over both dragged the app you were browsing off-screen. */}
            <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden p-2.5">
                <div className="flex min-h-0 flex-1 items-stretch gap-[10px]">
                    {/* Wide, the rail never goes away: the search belongs to the app selected in
                        it, so hiding it would take away the one control that changes the scope.
                        Narrow, it is the first step and leaves once an app is picked. */}
                    {isWide || onApps ? (
                        <EventAppRail
                            apps={apps}
                            // The apps step marks only a real pick: the wide rail's derived
                            // default would read as "this one is chosen" before anything was.
                            selectedKey={
                                isWide
                                    ? activeApp?.integrationKey
                                    : (railKey ?? connection?.integration_key)
                            }
                            isLoading={connectionsLoading}
                            onSelect={onSelectApp}
                            onConnectAnother={onConnectAnother}
                            full={!isWide}
                        />
                    ) : null}
                    {/* Only the right pane changes once an event is chosen — the rail stays put. */}
                    {!isWide && onApps ? null : showFilters ? (
                        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden pb-4">
                            <div className="flex flex-col gap-2">
                                <button
                                    type="button"
                                    onClick={() => setBrowsing(true)}
                                    className="flex w-fit cursor-pointer items-center gap-[5px] border-0 bg-transparent p-0 text-left text-[12px] text-muted-foreground hover:text-foreground"
                                >
                                    <ArrowLeft aria-hidden size={13} className="shrink-0" />
                                    <span className="min-w-0 truncate">
                                        {boundAppLabel
                                            ? t("automations.editor.allAppEvents", {
                                                  app: boundAppLabel,
                                              })
                                            : t("automations.editor.allConnectedEvents")}
                                    </span>
                                </button>
                                <span className="min-w-0 truncate text-[13px] font-medium text-foreground">
                                    {eventLabel(event?.name, eventKey)}
                                </span>
                            </div>
                            {eventLoading ? (
                                // Field-shaped, so the form lands where the placeholder was
                                // instead of under a "needs no filters" line that then vanishes.
                                <div className="flex flex-col gap-4">
                                    {Array.from({length: 3}, (_, index) => (
                                        <div key={index} className="flex flex-col gap-1.5">
                                            <SkeletonBlock active className="h-4 w-24" />
                                            <SkeletonBlock active className="h-9 w-full" />
                                        </div>
                                    ))}
                                </div>
                            ) : schema ? (
                                <SchemaForm
                                    ref={formRef}
                                    form={configForm}
                                    schema={schema}
                                    optionalLabel={(count) =>
                                        t("automations.editor.optionalFilters", {count})
                                    }
                                    onValuesChange={setValues}
                                />
                            ) : (
                                <p className="m-0 py-2 text-xs text-muted-foreground">
                                    {t("automations.editor.noFilters")}
                                </p>
                            )}
                        </div>
                    ) : activeApp ? (
                        // The search sits over the list it narrows rather than over the whole
                        // panel: it asks the selected app what it publishes, and a field above
                        // the rail read as a search of everything.
                        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
                            {isWide ? null : (
                                <button
                                    type="button"
                                    onClick={() => setOnApps(true)}
                                    className="flex w-fit cursor-pointer items-center gap-[5px] border-0 bg-transparent p-0 text-left text-[12px] text-muted-foreground hover:text-foreground"
                                >
                                    <ArrowLeft aria-hidden size={13} className="shrink-0" />
                                    <span className="min-w-0 truncate">
                                        {t("automations.editor.allApps")}
                                    </span>
                                </button>
                            )}
                            <EventList
                                app={activeApp}
                                // The check means "the event this automation has", not the one
                                // under consideration: a row looked at and left is not chosen.
                                // By app, not connection: the rail keeps one connection per app,
                                // and the bound one may not be the one it kept.
                                selectedEventKey={
                                    connection?.integration_key === activeApp.integrationKey
                                        ? (automation.eventKey ?? "")
                                        : ""
                                }
                                search={search}
                                onSearchChange={setSearch}
                                onPick={onPick}
                            />
                        </div>
                    ) : (
                        <EventPickerNoApps onConnect={onConnectAnother} />
                    )}
                </div>
            </div>

            {/* Done commits the filters, so it belongs to the event, not to browsing. */}
            {showFilters ? (
                <div className="flex shrink-0 items-center justify-end border-0 border-t border-solid border-border px-4 py-3">
                    <Button type="button" disabled={!ready || saving} onClick={() => void onDone()}>
                        {t("automations.editor.done")}
                    </Button>
                </div>
            ) : null}
        </div>
    )
}

/**
 * The event's required filters that are still blank.
 *
 * Drives the footer warning and the Done gate together, so the button and the sentence explaining
 * it can never disagree. JSON Schema's `required` is untyped here (the schema arrives as raw
 * provider JSON), hence the narrowing rather than a cast.
 */
function requiredGaps(
    schema: Record<string, unknown> | null,
    values: Record<string, unknown>,
): string[] {
    const declared = schema?.required
    if (!Array.isArray(declared)) return []
    return declared
        .filter((key): key is string => typeof key === "string")
        .filter((key) => {
            const value = values[key]
            if (value === undefined || value === null || value === "") return true
            return Array.isArray(value) && value.length === 0
        })
}

/**
 * Which event runs a new automation, open in the form (F05 f4): an "App" select over the connected
 * apps, an "Event" select over that app's events, and the event's filters with the optional ones
 * behind "Add optional filters (n)". Every change goes to the host's draft at once; nothing is
 * saved here. With no app connected, it offers to connect one.
 */
export const EventInlineCard = ({
    automation,
    onSelectEvent,
}: {
    automation: Automation
    onSelectEvent: (selection: EventSelection) => void
}) => {
    const t = useT(automationsEditorCatalog)
    const {connections, connectionsLoading, apps} = useConnectedApps()
    const openCatalogDrawer = useSetAtom(triggerCatalogDrawerOpenAtom)

    // The draft owns the app: the first connected app until one is picked, as the canvas shows
    // the form with an app.
    const app =
        apps.find((candidate) => candidate.connectionId === automation.connectionId) ?? apps[0]
    // The event and its filters wait here until the event's required filters are filled. Until
    // then the draft holds no event, so "Create automation" stays blocked, as Done does in the
    // picker.
    const [eventKey, setEventKey] = useState(automation.eventKey ?? "")
    const [values, setValues] = useState<Record<string, unknown>>({})

    const {
        events,
        isLoading: eventsLoading,
        hasNextPage,
        isFetchingNextPage,
        requestMore,
    } = useTriggerCatalogEvents(app?.integrationKey ?? "")
    // A select has no scroll to page on, so it loads every page of the app's events.
    useEffect(() => {
        if (hasNextPage && !isFetchingNextPage) requestMore()
    }, [hasNextPage, isFetchingNextPage, requestMore])
    const {event, isLoading: eventLoading} = useTriggerEvent(app?.integrationKey ?? "", eventKey)
    const schema = (event?.trigger_config ?? null) as Record<string, unknown> | null
    const [configForm] = useSchemaFormInstance()

    const formRef = useRef<SchemaFormHandle>(null)

    // The draft gets the event once its filters pass the form's own validation, read through
    // `getValues()` as the picker's Done does. Until then it holds no event, so Create stays
    // blocked. Empty required filters block at once, without painting errors on a fresh form.
    useEffect(() => {
        if (!app) return
        const connectionId = app.connectionId
        const block = () => onSelectEvent({connectionId, eventKey: "", triggerConfig: undefined})
        if (!eventKey || eventLoading || requiredGaps(schema, values).length) {
            block()
            return
        }
        if (!schema) {
            onSelectEvent({connectionId, eventKey, triggerConfig: undefined})
            return
        }
        let live = true
        const read = formRef.current?.getValues() ?? Promise.resolve(values)
        read.then(
            (valid) => {
                if (live)
                    onSelectEvent({
                        connectionId,
                        eventKey,
                        triggerConfig: normalizeRepoFilters(schema, valid),
                    })
            },
            () => {
                if (live) block()
            },
        )
        return () => {
            live = false
        }
    }, [app, eventKey, eventLoading, onSelectEvent, schema, values])

    // Another app starts with no event; another event starts its filters from empty.
    const selectApp = (connectionId: string) => {
        if (connectionId === app?.connectionId) return
        onSelectEvent({connectionId, eventKey: "", triggerConfig: undefined})
        setEventKey("")
    }
    useEffect(() => {
        configForm.resetFields()
        setValues({})
    }, [configForm, eventKey])

    const accountOf = (id: string) => {
        const connection = connections.find((candidate) => candidate.id === id)
        return connection?.name || connection?.slug || ""
    }

    if (!connectionsLoading && apps.length === 0)
        return <EventPickerNoApps onConnect={() => openCatalogDrawer(true)} />

    const label = "text-xs font-medium text-muted-foreground"
    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
                <span className={label}>{t("automations.editor.app")}</span>
                <Select value={app?.connectionId ?? ""} onValueChange={selectApp}>
                    <SelectTrigger
                        className="h-auto min-h-11 py-1.5"
                        aria-label={t("automations.editor.app")}
                    >
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {apps.map((candidate) => (
                            <SelectItem key={candidate.connectionId} value={candidate.connectionId}>
                                <span className="flex min-w-0 flex-col text-left">
                                    <span className="truncate">{candidate.label}</span>
                                    {accountOf(candidate.connectionId) ? (
                                        <span className="truncate text-xs font-normal text-colorTextTertiary">
                                            {accountOf(candidate.connectionId)}
                                        </span>
                                    ) : null}
                                </span>
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            <div className="flex flex-col gap-1">
                <span className={label}>{t("automations.editor.event")}</span>
                <Select
                    value={eventKey}
                    disabled={!app || eventsLoading}
                    onValueChange={setEventKey}
                >
                    <SelectTrigger aria-label={t("automations.editor.event")}>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {events.map((candidate) => (
                            <SelectItem key={candidate.key} value={candidate.key}>
                                {eventLabel(candidate.name, candidate.key)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            {schema ? (
                <SchemaForm
                    ref={formRef}
                    form={configForm}
                    schema={schema}
                    optionalLabel={(count) => t("automations.editor.optionalFilters", {count})}
                    onValuesChange={setValues}
                />
            ) : null}
        </div>
    )
}
