/** The subscription drawer's sectioned create/edit form (one per draft or saved trigger). */
import {useCallback, useEffect, useMemo, useRef, useState} from "react"

/* Unused while the Deployed option is hidden — restore with the call site below.
import {
    appEnvironmentsQueryAtomFamily,
    environmentsListQueryAtomFamily,
} from "@agenta/entities/environment"
*/
import {
    getScheduleMessagePreview,
    parseInputsFields,
    isEntityActive,
    isEntityValid,
    testTriggerSubscription,
    triggerApiErrorMessage,
    triggerSubscriptionDrawerAtom,
    useTriggerConnectionsQuery,
    useTriggerEvent,
    useTriggerSubscription,
    useTriggerSubscriptions,
    type TriggerConnection,
    type TriggerSubscriptionCreate,
    type TriggerSubscriptionData,
    type TriggerSubscriptionEdit,
} from "@agenta/entities/gatewayTrigger"
import {extractInputPortsFromSchema} from "@agenta/entities/runnable"
import {workflowMolecule} from "@agenta/entities/workflow"
import {dayjs} from "@agenta/shared/utils"
import {message} from "@agenta/ui"
import {HeightCollapse} from "@agenta/ui/components"
import {Input} from "@agenta/ui/ui"
// SchemaForm takes a form instance; this one only exists to prefill trigger_config.
import {CaretDown, SlidersHorizontal} from "@phosphor-icons/react"
import {useForm} from "@rc-component/form"
import {useAtom, useAtomValue, useSetAtom} from "jotai"

import {DrawerFooter} from "../../../drawers/shared/DrawerFooter"
import {Labelled} from "../../../drawers/shared/Labelled"
import {type SchemaFormHandle} from "../../../gatewayTool/components/SchemaForm"
import {AgentField} from "../shared/AgentField"
import {loadRecentSamples, waitForNewDelivery} from "../shared/deliveries"
import {type SampledEvent} from "../shared/EventSourcePicker"
import {SubscriptionFormSkeleton} from "../shared/FormSkeleton"
import {normalizeJson} from "../shared/normalizeJson"
import {
    bindingKey,
    buildTriggerReferences,
    useBoundAgentShape,
    useTriggerBinding,
    type TriggerBinding,
} from "../shared/useTriggerBinding"
import {VersionField} from "../shared/VersionField"

import {browseHeaderAtom, DEFAULT_INPUTS_MAPPING} from "./constants"
import {eventExampleFromPayload, suggestSubscriptionName} from "./helpers"
import {MappingSection} from "./MappingSection"
import {SourceBrowsePage} from "./SourceBrowsePage"
import {EventFiltersField, SourceField} from "./SourceField"

// ---------------------------------------------------------------------------
// SubscriptionForm — a flat field stack: Name, Trigger, Message, and an Advanced disclosure
// holding the bound version and the event's own filters. Mirrors the schedule form.
// ---------------------------------------------------------------------------

export function SubscriptionForm({
    subscriptionId,
    onClose,
    onSaved,
}: {
    subscriptionId?: string
    onClose: () => void
    onSaved?: (savedId: string) => void
}) {
    const [state] = useAtom(triggerSubscriptionDrawerAtom)
    const isEdit = !!subscriptionId
    const playgroundEntityId = state?.playgroundEntityId

    const {connections} = useTriggerConnectionsQuery()
    const {
        subscription,
        isLoading: subLoading,
        isFetching: subFetching,
        isMutating,
        create,
        edit,
    } = useTriggerSubscription(subscriptionId)
    const isDeleted = Boolean(subscription?.deleted_at)

    const [name, setName] = useState("")
    const [connectionId, setConnectionId] = useState<string | undefined>(state?.connectionId)
    const [eventKey, setEventKey] = useState(state?.eventKey ?? "")
    // Carried through save, not editable here — active/paused is toggled from the triggers list.
    const [enabled, setEnabled] = useState(true)
    const [advancedOpen, setAdvancedOpen] = useState(false)
    // Settings picks the agent; the playground and edit mode resolve it (see `resolved`).
    const [agentWorkflowId, setAgentWorkflowId] = useState<string | null>(null)
    const [binding, setBinding] = useState<TriggerBinding | null>(null)
    const [inputsText, setInputsText] = useState(DEFAULT_INPUTS_MAPPING)
    const [inputsError, setInputsError] = useState<string | null>(null)
    // The field UI sources from the RAW event only: a draft's /test probe (raw
    // event.attributes), else the catalog event schema. A saved trigger's captured DELIVERY
    // is the mapped OUTPUT — kept separate so it never pollutes the field panel.
    const [capturedRawEvent, setCapturedRawEvent] = useState<Record<string, unknown> | null>(null)
    const [lastDelivery, setLastDelivery] = useState<Record<string, unknown> | null>(null)
    // Source selection is a full page within the drawer (not inlined in the section). A new
    // playground trigger opens straight into it — picking the app/event is the first step,
    // so don't make the user click through the form to reach it.
    const [browsing, setBrowsing] = useState(
        () => !!playgroundEntityId && !subscriptionId && !state?.eventKey,
    )
    // Publish browse state to the drawer header (only while this form is the visible one).
    const setBrowseHeader = useSetAtom(browseHeaderAtom)
    useEffect(() => {
        if (browsing) {
            setBrowseHeader({onBack: () => setBrowsing(false)})
            return () => setBrowseHeader(null)
        }
        return undefined
    }, [browsing, setBrowseHeader])

    // The binding as persisted — never re-picked on open, so opening a trigger can't rebind it.
    const storedReferences = subscription?.data?.references
    const resolved = useTriggerBinding({
        storedReferences: isEdit ? storedReferences : state?.defaultReferences,
        playgroundEntityId,
        agentWorkflowId,
    })
    // Baseline excludes the agent the user picked, or a rebind would move both sides of the
    // dirty check together and leave Save disabled.
    const baselineBinding = useTriggerBinding({
        storedReferences: isEdit ? storedReferences : state?.defaultReferences,
        playgroundEntityId,
    })
    const activeBinding = binding ?? resolved
    const versionChosen = !!activeBinding.workflowId || !!activeBinding.variantId

    // The bound agent's display name — the Name placeholder uses it.
    const agentName = useAtomValue(
        workflowMolecule.selectors.artifactName(
            activeBinding.workflowId ?? playgroundEntityId ?? "",
        ),
    )

    const {subscriptions} = useTriggerSubscriptions()
    const alreadySubscribed = useMemo(
        () =>
            Boolean(connectionId && eventKey) &&
            subscriptions.some(
                (s) =>
                    s.id !== subscriptionId &&
                    s.connection_id === connectionId &&
                    s.data?.event_key === eventKey,
            ),
        [subscriptions, connectionId, eventKey, subscriptionId],
    )

    const [configForm] = useForm()
    const configFormRef = useRef<SchemaFormHandle>(null)

    // Prefill from the freshly-fetched subscription (edit mode). Hydrate once per id: any
    // trigger mutation invalidates this query, and a background refetch must not overwrite
    // the edits in progress.
    const hydratedId = useRef<string | null>(null)
    useEffect(() => {
        if (!isEdit || !subscription) return
        // A refetch serves the stale cache first. Latching on that would freeze the fields on old
        // values (the fresh result hits the guard below and returns) and save them back.
        if (subFetching) return
        const loadedId = (subscription.id as string | undefined) ?? subscriptionId ?? null
        if (hydratedId.current === loadedId) return
        hydratedId.current = loadedId
        setName(subscription.name ?? "")
        setConnectionId(subscription.connection_id)
        setEventKey(subscription.data?.event_key ?? "")
        setEnabled(isEntityActive(subscription))
        setInputsText(
            subscription.data?.inputs_fields
                ? JSON.stringify(subscription.data.inputs_fields, null, 2)
                : DEFAULT_INPUTS_MAPPING,
        )
        if (subscription.data?.trigger_config) {
            configForm.setFieldsValue(subscription.data.trigger_config)
        }
        // The binding is derived from the stored references, never re-picked on open.
    }, [isEdit, subscription, subFetching, subscriptionId, configForm])

    const selectedConnection = useMemo<TriggerConnection | undefined>(
        () => connections.find((c) => c.id === connectionId),
        [connections, connectionId],
    )
    const integrationKey = selectedConnection?.integration_key ?? ""

    const {event: eventDetail} = useTriggerEvent(integrationKey, eventKey)
    const triggerConfigSchema = (eventDetail?.trigger_config ?? null) as Record<
        string,
        unknown
    > | null

    // Shown as the placeholder and saved verbatim when the field is left empty, so a trigger
    // is never nameless — "Issue opened — Bug report".
    const namePlaceholder = useMemo(
        () => suggestSubscriptionName(eventDetail?.name ?? eventKey, agentName),
        [eventDetail?.name, eventKey, agentName],
    )

    const baselineSnapshot = useMemo(() => {
        if (isEdit && subscription) {
            return JSON.stringify({
                name: subscription.name ?? "",
                connectionId: subscription.connection_id ?? null,
                eventKey: subscription.data?.event_key ?? "",
                enabled: isEntityActive(subscription),
                binding: bindingKey(baselineBinding),
                inputs: subscription.data?.inputs_fields
                    ? JSON.stringify(subscription.data.inputs_fields)
                    : normalizeJson(DEFAULT_INPUTS_MAPPING),
            })
        }
        return JSON.stringify({
            name: "",
            connectionId: state?.connectionId ?? null,
            eventKey: state?.eventKey ?? "",
            enabled: true,
            binding: bindingKey(baselineBinding),
            inputs: normalizeJson(DEFAULT_INPUTS_MAPPING),
        })
    }, [isEdit, subscription, state?.connectionId, state?.eventKey, baselineBinding])

    const isDirty = useMemo(
        () =>
            baselineSnapshot !==
            JSON.stringify({
                name,
                connectionId: connectionId ?? null,
                eventKey,
                enabled,
                binding: bindingKey(activeBinding),
                inputs: normalizeJson(inputsText),
            }),
        [baselineSnapshot, name, connectionId, eventKey, enabled, activeBinding, inputsText],
    )

    const buildData = useCallback(async (): Promise<TriggerSubscriptionData | null> => {
        if (!connectionId) {
            message.error("Select a connection")
            return null
        }
        if (!eventKey) {
            message.error("Select an event")
            return null
        }
        if (!versionChosen) {
            message.error("Pick the agent this trigger runs")
            return null
        }

        const parsedInputs = parseInputsFields(inputsText)
        if (parsedInputs.error) {
            setInputsError(parsedInputs.error)
            message.error(parsedInputs.error)
            return null
        }
        setInputsError(null)
        const inputsFields = parsedInputs.value

        let triggerConfig: Record<string, unknown> | undefined
        try {
            triggerConfig = (await configFormRef.current?.getValues()) ?? undefined
        } catch {
            return null
        }

        return {
            event_key: eventKey,
            trigger_config: triggerConfig,
            inputs_fields: inputsFields,
            references: buildTriggerReferences(activeBinding, storedReferences),
        }
    }, [connectionId, eventKey, versionChosen, activeBinding, storedReferences, inputsText])

    const handleSubmit = useCallback(async () => {
        if (isDeleted) return
        const data = await buildData()
        if (!data || !connectionId) return
        const resolvedName = name.trim() || namePlaceholder || null
        try {
            let savedId: string | null = null
            if (isEdit && subscription) {
                const body: TriggerSubscriptionEdit = {
                    id: subscription.id as string,
                    name: resolvedName,
                    description: subscription.description ?? null,
                    tags: subscription.tags ?? null,
                    meta: subscription.meta ?? null,
                    connection_id: connectionId,
                    data: {...subscription.data, ...data},
                    flags: {
                        ...(subscription.flags ?? {}),
                        is_active: enabled,
                        is_valid: isEntityValid(subscription),
                    },
                }
                const result = await edit(body)
                if (!result) {
                    message.error("Failed to update trigger")
                    return
                }
                savedId = result.id ?? null
                message.success("Trigger updated")
            } else {
                const body: TriggerSubscriptionCreate = {
                    name: resolvedName,
                    connection_id: connectionId,
                    data,
                    // Honor the Active toggle at creation (BE defaults to active; is_valid
                    // defaults to true). Otherwise a paused-on-create trigger starts active.
                    flags: {is_active: enabled},
                }
                const result = await create(body)
                if (!result) {
                    message.error("Failed to create trigger")
                    return
                }
                savedId = result.id ?? null
                message.success("Trigger created")
            }
            if (!isEdit) {
                // A newly created trigger dismisses the drawer; it now shows in the triggers list.
                onClose()
            } else if (onSaved && savedId) {
                onSaved(savedId)
            } else {
                onClose()
            }
        } catch (error) {
            message.error(triggerApiErrorMessage(error, "Failed to save trigger"))
        }
    }, [
        buildData,
        connectionId,
        isEdit,
        subscription,
        name,
        namePlaceholder,
        enabled,
        edit,
        create,
        onClose,
        onSaved,
        isDeleted,
    ])

    // Recent real deliveries to offer in the picker (edit mode only — a saved sub has history).
    const [recentSamples, setRecentSamples] = useState<SampledEvent[]>([])
    const sampleLabel = eventDetail?.name ?? eventKey
    useEffect(() => {
        if (!subscriptionId) {
            setRecentSamples([])
            return
        }
        let cancelled = false
        loadRecentSamples(subscriptionId, sampleLabel)
            .then((samples) => {
                if (!cancelled) setRecentSamples(samples)
            })
            .catch(() => {
                // A fetch failure must not render as "no events captured yet" (WEB-2).
                if (!cancelled) message.error("Couldn't load recent events")
            })
        return () => {
            cancelled = true
        }
    }, [subscriptionId, sampleLabel])

    // Capture a real event for the mapping. A SAVED trigger already occupies its provider
    // `ti_*`, so re-running the /test endpoint would collide on the unique trigger_id — poll
    // the live subscription's own deliveries instead. A DRAFT has no live sub yet, so spin up
    // a throwaway is_test subscription whose probe returns the raw `event.attributes`.
    const onWaitForEvent = useCallback(async (): Promise<SampledEvent | null> => {
        if (!connectionId || !eventKey) return null

        if (subscriptionId) {
            try {
                const result = await waitForNewDelivery(subscriptionId, sampleLabel)
                if (!result) {
                    message.info("No event arrived yet — trigger it from the app, then try again.")
                    return null
                }
                setRecentSamples(result.recent)
                message.success("Event captured — sample applied to the mapping.")
                return result.sample
            } catch (error) {
                message.error(triggerApiErrorMessage(error, "Failed to capture an event"))
                return null
            }
        }

        let triggerConfig: Record<string, unknown> | undefined
        try {
            triggerConfig = (await configFormRef.current?.getValues()) ?? undefined
        } catch {
            // The probe doesn't require a valid config; ignore validation here.
        }
        try {
            const res = await testTriggerSubscription({
                name: null,
                connection_id: connectionId,
                data: {
                    event_key: eventKey,
                    trigger_config: triggerConfig,
                    inputs_fields: {payload: "$.event.attributes"},
                },
            })
            const inputs = res.delivery?.data?.inputs
            const payload = (
                inputs && typeof inputs === "object"
                    ? ((inputs as Record<string, unknown>).payload ?? inputs)
                    : null
            ) as Record<string, unknown> | null
            if (!res.delivery || !payload) {
                message.info("No event captured yet — trigger it from the app, then try again.")
                return null
            }
            // The user is likely off in the other app; make the late capture audible.
            message.success("Event captured — sample applied to the mapping.")
            const sample: SampledEvent = {
                id: res.delivery.id ?? "live",
                label: sampleLabel,
                preview: getScheduleMessagePreview(payload) || undefined,
                timeAgo: dayjs().format("MMM D, HH:mm"),
                payload,
            }
            // Teardown cascade-deletes the throwaway sub's delivery server-side, so keep
            // the capture client-side or "Recent events" stays empty for drafts.
            setRecentSamples((prev) => [sample, ...prev].slice(0, 3))
            return sample
        } catch (error) {
            message.error(triggerApiErrorMessage(error, "Failed to capture an event"))
            return null
        }
    }, [connectionId, eventKey, subscriptionId, sampleLabel])

    const sourceChosen = !!connectionId && !!eventKey
    // Create is gated on completeness, not on dirtiness: a trigger seeded from the catalog
    // (connection + event + default binding) already matches its baseline, and gating on
    // `isDirty` would leave Create disabled until the user edited an unrelated field.
    const canSubmit = !isDeleted && (isEdit ? isDirty : sourceChosen && versionChosen)

    // Agent-type-aware mapping target (same split as the schedule composer): chat agents
    // take a `messages` array, completion agents the first string input from their schema.
    // Most specific id the molecule can resolve, so a settings-created trigger doesn't read
    // as a completion app and write to the wrong input key.
    const schemaSourceId =
        playgroundEntityId ??
        activeBinding.revisionId ??
        activeBinding.variantId ??
        activeBinding.workflowId ??
        ""
    // Only agent workflows get the token composer; non-agent bound workflows keep the
    // raw-JSON mapping editor (committed behavior).
    // The molecule only resolves where an app is open (the playground); from settings it never
    // does, so fall back to the bound revision's own flags.
    const boundShape = useBoundAgentShape(activeBinding)
    // Raw JSON is for workflows we KNOW aren't agents; an unbound drawer shows the composer
    // rather than greeting the user with a JSON blob.
    const isAgent =
        useAtomValue(workflowMolecule.selectors.isAgent(schemaSourceId)) ||
        boundShape.isAgent ||
        !boundShape.resolved
    const isChatInput =
        useAtomValue(workflowMolecule.selectors.executionMode(schemaSourceId)) === "chat" ||
        boundShape.isChat
    const agentInputSchema =
        useAtomValue(workflowMolecule.selectors.inputSchema(schemaSourceId)) ??
        boundShape.inputSchema
    const primaryInputKey = useMemo(() => {
        if (isChatInput) return "messages"
        const ports = extractInputPortsFromSchema(agentInputSchema)
        return ports.find((p) => p.type === "string")?.key ?? "message"
    }, [isChatInput, agentInputSchema])

    // Field UI sources from the raw event only (never the mapped delivery output).
    const eventSample =
        capturedRawEvent ??
        eventExampleFromPayload(eventDetail?.payload as Record<string, unknown> | null)
    // Picker results route by mode: a saved trigger yields a delivery (mapped output → preview
    // only); a draft yields a raw event (→ field source).
    const onSample = useCallback(
        (ev: SampledEvent) => {
            const payload =
                ev.payload && typeof ev.payload === "object"
                    ? (ev.payload as Record<string, unknown>)
                    : null
            if (subscriptionId) setLastDelivery(payload)
            else setCapturedRawEvent(payload)
        },
        [subscriptionId],
    )

    if (isEdit && subLoading) {
        return <SubscriptionFormSkeleton showAgent={!playgroundEntityId} />
    }

    if (browsing) {
        return (
            <SourceBrowsePage
                connections={connections}
                // Re-opening an already-chosen trigger lands on that app's event list, not
                // back at the app grid — the user is changing the event, not the app.
                defaultIntegrationKey={selectedConnection?.integration_key ?? state?.integrationKey}
                onPick={(cid, ek) => {
                    setConnectionId(cid)
                    setEventKey(ek)
                    setBrowsing(false)
                }}
            />
        )
    }

    return (
        <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
            {isDeleted ? (
                <p className="m-0 bg-colorWarningBg px-6 py-3 text-xs text-colorWarningText">
                    This event subscription was deleted. Its saved configuration is read-only.
                </p>
            ) : null}
            <fieldset disabled={isDeleted} className="contents">
                {/* ag-scroll-quiet: no resting scrollbar over the form, thumb on hover/focus,
                    stable gutter so revealing it never reflows the fields. */}
                <div className="ag-scroll-quiet flex flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-6 py-5">
                    <Labelled label="Name">
                        <Input
                            placeholder={namePlaceholder}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    </Labelled>

                    {!playgroundEntityId && (
                        <Labelled label="Agent">
                            <AgentField
                                workflowId={activeBinding.workflowId}
                                onChange={(id) => {
                                    setAgentWorkflowId(id)
                                    // A different agent invalidates any pinned revision.
                                    setBinding(null)
                                }}
                                disabled={isMutating}
                            />
                        </Labelled>
                    )}

                    <Labelled label="Trigger">
                        <SourceField
                            connections={connections}
                            connectionId={connectionId}
                            eventKey={eventKey}
                            eventName={eventDetail?.name ?? undefined}
                            onBrowse={() => setBrowsing(true)}
                            onClear={() => {
                                setConnectionId(undefined)
                                setEventKey("")
                                // The filters belong to the event's own schema.
                                configForm.resetFields()
                            }}
                            isEdit={isEdit}
                        />
                    </Labelled>

                    {/* Not Advanced: many events (GitHub's owner/repo) can't fire without these,
                        so they belong in the main flow right under the event they filter. */}
                    {sourceChosen && triggerConfigSchema ? (
                        <Labelled label="Event filters">
                            <EventFiltersField
                                triggerConfigSchema={triggerConfigSchema}
                                configForm={configForm}
                                configFormRef={configFormRef}
                            />
                        </Labelled>
                    ) : null}

                    <Labelled label="What the agent gets">
                        <MappingSection
                            value={inputsText}
                            onChange={setInputsText}
                            error={inputsError}
                            onErrorChange={setInputsError}
                            eventSample={eventSample}
                            deliveryPreview={lastDelivery}
                            onSample={onSample}
                            onWaitForEvent={onWaitForEvent}
                            recentEvents={recentSamples}
                            isAgent={isAgent}
                            isEdit={isEdit}
                            hasSource={sourceChosen}
                            isChat={isChatInput}
                            primaryKey={primaryInputKey}
                            disabled={isDeleted}
                        />
                    </Labelled>

                    <div className="flex flex-col">
                        <button
                            type="button"
                            onClick={() => setAdvancedOpen((v) => !v)}
                            aria-expanded={advancedOpen}
                            // px-0/font-[inherit]: preflight is off, so a bare button keeps the
                            // UA's 6px inline padding (misaligning it from the fields) and Arial.
                            className="flex items-center justify-between border-0 border-t border-solid border-[var(--ag-colorBorderSecondary)] bg-transparent px-0 py-3 font-[inherit]"
                        >
                            <span className="flex items-center gap-2">
                                <SlidersHorizontal
                                    size={15}
                                    className="text-[var(--ag-colorTextSecondary)]"
                                />
                                <span className="text-xs font-medium text-[var(--ag-colorText)]">
                                    Advanced
                                </span>
                            </span>
                            <CaretDown
                                size={14}
                                className={`text-[var(--ag-colorIcon)] transition-transform ${
                                    advancedOpen ? "" : "-rotate-90"
                                }`}
                            />
                        </button>
                        <HeightCollapse open={advancedOpen}>
                            <div className="flex flex-col gap-5 pb-2 pt-1">
                                <Labelled label="Version">
                                    <VersionField
                                        workflowId={activeBinding.workflowId}
                                        binding={activeBinding}
                                        onChange={setBinding}
                                        disabled={isMutating}
                                    />
                                </Labelled>
                            </div>
                        </HeightCollapse>
                    </div>
                </div>
            </fieldset>

            <DrawerFooter
                left={
                    isDeleted ? (
                        <span className="text-xs text-colorTextSecondary">Deleted</span>
                    ) : undefined
                }
                onCancel={onClose}
                isMutating={isMutating}
                canSave={canSubmit && !alreadySubscribed}
                submitLabel={isEdit ? "Save" : "Create"}
                onSubmit={handleSubmit}
            />
        </div>
    )
}
