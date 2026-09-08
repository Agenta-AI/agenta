import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    triggerCatalogDrawerOpenAtom,
    triggerEventsSearchAtom,
    useTriggerCatalogIntegrations,
    useTriggerConnectionsQuery,
    useTriggerEvent,
    type TriggerSubscription,
} from "@agenta/entities/gatewayTrigger"
import {SchemaForm, type SchemaFormHandle} from "@agenta/entity-ui/gatewayTool"
import {useSchemaFormInstance} from "@agenta/entity-ui/gatewayTrigger"
import {ArrowLeft, Warning} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"
import {Plug, Search} from "lucide-react"

import {Button} from "@/components/ui/button"
import {Input} from "@/components/ui/input"

import type {Automation} from "../automationModel"

import {appLabel, connectedApps, eventLabel, type ConnectedApp} from "./connectedApps"
import {EventAppRail} from "./EventAppRail"
import {EventList} from "./EventList"
import {EventSearchResults} from "./EventSearchResults"

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
 * and "Connect another app…" stay where they were, so picking a different app is still one click.
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
    const {connections, isLoading: connectionsLoading} = useTriggerConnectionsQuery()

    const [connectionId, setConnectionId] = useState(automation.connectionId ?? undefined)
    const [eventKey, setEventKey] = useState(automation.eventKey ?? "")
    const [browsing, setBrowsing] = useState(!automation.eventKey)
    const [values, setValues] = useState<Record<string, unknown>>({})
    const [saving, setSaving] = useState(false)
    const [search, setSearch] = useState("")
    /** Only what the user clicked in the rail — the default is derived, so it can arrive late. */
    const [railKey, setRailKey] = useState<string | undefined>(undefined)

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

    const apps = useMemo(() => connectedApps(connections), [connections])
    const connection = useMemo(
        () => connections.find((candidate) => candidate.id === connectionId),
        [connections, connectionId],
    )
    const {event} = useTriggerEvent(connection?.integration_key ?? "", eventKey)
    const schema = (event?.trigger_config ?? null) as Record<string, unknown> | null

    const activeApp = useMemo<ConnectedApp | undefined>(() => {
        const key = railKey ?? connection?.integration_key
        return apps.find((app) => app.integrationKey === key) ?? apps[0]
    }, [apps, connection?.integration_key, railKey])

    const query = search.trim()

    // Debounced, because the atom is a query key: every keystroke would be a request per app.
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

    // A query is a request to browse, whatever was picked before: the results own the right pane
    // until the field is cleared, and the picked event is still there underneath.
    const showFilters = !browsing && !query

    const missing = useMemo(() => requiredGaps(schema, values), [schema, values])
    const ready = Boolean(connectionId && eventKey) && missing.length === 0

    const onPick = useCallback((pickedConnectionId: string, pickedEventKey: string) => {
        setConnectionId(pickedConnectionId)
        setEventKey(pickedEventKey)
        setBrowsing(false)
        setSearch("")
    }, [])

    // The rail never leaves, so it is also the way out of an event's filters: picking an app is
    // asking for its events.
    const onSelectApp = useCallback((app: ConnectedApp) => {
        setRailKey(app.integrationKey)
        setBrowsing(true)
    }, [])

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
            const triggerConfig = await formRef.current?.getValues()
            onSelectEvent({connectionId, eventKey, triggerConfig: triggerConfig ?? undefined})
            onClose()
        } catch {
            // Validation failed: the overlay stays open with the edit intact.
        } finally {
            setSaving(false)
        }
    }, [connectionId, eventKey, onClose, onSelectEvent])

    // The catalog's display name, not the integration key made readable: "Google Calendar",
    // not "Googlecalendar".
    const {integrations} = useTriggerCatalogIntegrations()
    const boundAppLabel = connection
        ? appLabel(
              connection,
              integrations.find((integration) => integration.key === connection.integration_key)
                  ?.name,
          )
        : (activeApp?.label ?? "connected")

    return (
        <div className="flex min-h-0 flex-col">
            <div className="flex min-h-0 flex-1 flex-col gap-2.5 p-2.5">
                <div className="relative">
                    <Search
                        aria-hidden
                        className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                    />
                    <Input
                        value={search}
                        onChange={(changed) => setSearch(changed.target.value)}
                        aria-label="Search events"
                        placeholder="Search events — try “issue”"
                        className="h-8 pl-8 text-[13px]"
                    />
                </div>

                <div className="flex min-h-0 flex-1 gap-[10px]">
                    {/* A query searches every app at once, so the rail has nothing to filter. */}
                    {query ? null : (
                        <EventAppRail
                            apps={apps}
                            selectedKey={activeApp?.integrationKey}
                            isLoading={connectionsLoading}
                            onSelect={onSelectApp}
                        />
                    )}
                    {/* Only the right pane changes once an event is chosen — the rail stays put. */}
                    {showFilters ? (
                        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-y-auto">
                            <div className="flex flex-col gap-1">
                                <button
                                    type="button"
                                    onClick={() => setBrowsing(true)}
                                    className="flex w-fit cursor-pointer items-center gap-[5px] border-0 bg-transparent p-0 text-left text-[12px] text-muted-foreground hover:text-foreground"
                                >
                                    <ArrowLeft aria-hidden size={13} className="shrink-0" />
                                    <span className="min-w-0 truncate">
                                        All {boundAppLabel} events
                                    </span>
                                </button>
                                <span className="min-w-0 truncate text-[13px] font-medium text-foreground">
                                    {eventLabel(event?.name, eventKey)}
                                </span>
                            </div>
                            {schema ? (
                                <SchemaForm
                                    ref={formRef}
                                    form={configForm}
                                    schema={schema}
                                    optionalLabel={(count) => `Add optional filters (${count})`}
                                    onValuesChange={setValues}
                                />
                            ) : (
                                <p className="m-0 py-2 text-xs text-muted-foreground">
                                    This event needs no filters — it runs every time it arrives.
                                </p>
                            )}
                        </div>
                    ) : query ? (
                        <EventSearchResults
                            apps={apps}
                            selectedEventKey={eventKey}
                            onPick={onPick}
                        />
                    ) : activeApp ? (
                        <EventList app={activeApp} selectedEventKey={eventKey} onPick={onPick} />
                    ) : (
                        <p className="m-0 min-w-0 flex-1 px-2 py-3 text-[12px] leading-snug text-muted-foreground">
                            Connect an app to watch its events.
                        </p>
                    )}
                </div>

                <button
                    type="button"
                    onClick={onConnectAnother}
                    className="flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-2 py-1.5 text-left text-[13px] text-muted-foreground hover:bg-muted"
                >
                    <Plug aria-hidden className="size-3.5 shrink-0" />
                    <span className="min-w-0 truncate">Connect another app…</span>
                </button>
            </div>

            {/* Done commits the filters, so it belongs to the event, not to browsing. */}
            {showFilters ? (
                <div className="flex shrink-0 items-center gap-3 border-0 border-t border-solid border-border px-4 py-3">
                    {missing.length ? (
                        <p className="m-0 flex min-w-0 flex-1 items-center gap-1.5 text-xs leading-snug text-muted-foreground">
                            <Warning aria-hidden size={14} className="shrink-0" />
                            <span className="min-w-0">
                                {missing.length === 1
                                    ? "One filter is still empty"
                                    : `${missing.length} filters are still empty`}
                                {" — without them this event never arrives."}
                            </span>
                        </p>
                    ) : (
                        <span className="flex-1" />
                    )}
                    <Button
                        type="button"
                        size="sm"
                        className="text-xs font-normal"
                        disabled={!ready || saving}
                        onClick={() => void onDone()}
                    >
                        Done
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
