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
import {appWorkflowsListQueryStateAtom, workflowMolecule} from "@agenta/entities/workflow"
import {dayjs} from "@agenta/shared/utils"
import {message} from "@agenta/ui"
import {ConfigAccordionSection} from "@agenta/ui/components/presentational"
import {Input, Spinner} from "@agenta/ui/ui"
import {FlowArrow, GitBranch, Lightning, Tag} from "@phosphor-icons/react"
// SchemaForm takes a form instance; this one only exists to prefill trigger_config.
import {useForm} from "@rc-component/form"
import {useAtom, useAtomValue, useSetAtom} from "jotai"

import {DrawerFooter} from "../../../drawers/shared/DrawerFooter"
import {type SchemaFormHandle} from "../../../gatewayTool/components/SchemaForm"
import {
    createWorkflowRevisionAdapter,
    type WorkflowRevisionSelectionResult,
} from "../../../selection"
import {loadRecentSamples, waitForNewDelivery} from "../shared/deliveries"
import {type SampledEvent} from "../shared/EventSourcePicker"
import {normalizeJson} from "../shared/normalizeJson"
import {RequiredTitle} from "../shared/RequiredTitle"
import {
    RunVersionField,
    buildRunVersionReferences,
    extractBoundWorkflowId,
    isRunVersionBound,
} from "../shared/RunVersionField"

import {applicationRevisionAdapter, browseHeaderAtom, DEFAULT_INPUTS_MAPPING} from "./constants"
import {eventExampleFromPayload, extractBoundRevId, connectionName} from "./helpers"
import {MappingSection} from "./MappingSection"
import {RunSubscriptionButton} from "./RunSubscriptionButton"
import {SourceBrowsePage} from "./SourceBrowsePage"
import {SourceField} from "./SourceField"

// ---------------------------------------------------------------------------
// SubscriptionForm — the sectioned config (mirrors the schedule form sections):
// Name / When this happens / Which version runs? / What the agent gets, + footer.
// ---------------------------------------------------------------------------

export function SubscriptionForm({
    subscriptionId,
    onClose,
    hidden,
    onNameChange,
    onSaved,
}: {
    subscriptionId?: string
    onClose: () => void
    hidden?: boolean
    onNameChange?: (name: string) => void
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

    const [name, setName] = useState("")
    const [connectionId, setConnectionId] = useState<string | undefined>(state?.connectionId)
    const [eventKey, setEventKey] = useState(state?.eventKey ?? "")
    const [enabled, setEnabled] = useState(true)
    const [workflowRevId, setWorkflowRevId] = useState<string | null>(null)
    const [workflowSelection, setWorkflowSelection] =
        useState<WorkflowRevisionSelectionResult | null>(null)
    const [workflowLabel, setWorkflowLabel] = useState<string | null>(null)
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
        if (browsing && !hidden) {
            setBrowseHeader({onBack: () => setBrowsing(false)})
            return () => setBrowseHeader(null)
        }
        return undefined
    }, [browsing, hidden, setBrowseHeader])

    const [bindMode, setBindMode] = useState<"revision" | "environment">("revision")
    const [environmentSlug, setEnvironmentSlug] = useState<string | null>(null)
    const [appSlug, setAppSlug] = useState<string | null>(null)

    // Resolve the playground workflow so the version picker + env list scope to this agent.
    const playgroundWorkflow = useAtomValue(
        workflowMolecule.selectors.data(playgroundEntityId ?? ""),
    )
    const workflowRevId0 = playgroundEntityId ?? null
    // The binding as persisted — the picker's leaf can't represent every shape the BE accepts.
    const storedReferences = subscription?.data?.references
    const versionChosen = isRunVersionBound({
        bindMode,
        workflowRevId,
        environmentSlug,
        storedReferences,
    })
    const revisionAdapter = useMemo(() => {
        if (!playgroundEntityId) return applicationRevisionAdapter
        return createWorkflowRevisionAdapter({
            workflowListAtom: appWorkflowsListQueryStateAtom,
            workflowId: playgroundWorkflow?.workflow_id ?? playgroundEntityId,
            excludeRevisionZero: true,
            parentLabel: "Variant",
        })
    }, [playgroundEntityId, playgroundWorkflow?.workflow_id])
    const playgroundAppName = useAtomValue(
        workflowMolecule.selectors.artifactName(playgroundEntityId ?? ""),
    )
    // Friendly name for the bound revision (used when no fresh-pick label is set, e.g.
    // after create/edit reload) so the version picker never shows a raw id.
    const resolvedRevisionName = useAtomValue(
        workflowMolecule.selectors.artifactName(workflowRevId ?? ""),
    )

    /* Unused while the Deployed option is hidden — restore with the call site below.
    const envQuery = useAtomValue(environmentsListQueryAtomFamily(false))
    const environments = envQuery.data?.environments ?? []
    const appIdForEnv = playgroundEntityId
        ? (playgroundWorkflow?.workflow_id ?? playgroundEntityId)
        : ""
    const appDeployments = useAtomValue(appEnvironmentsQueryAtomFamily(appIdForEnv))
    const envOptions = useMemo<{value: string; label: string}[]>(() => {
        if (!playgroundEntityId) {
            return environments.map((e) => ({value: e.slug ?? "", label: e.name || e.slug || ""}))
        }
        return (appDeployments.data ?? [])
            .filter((d) => d.deployedRevisionId || d.deployedVariantId)
            .map((d) => ({
                value: d.slug ?? "",
                label:
                    d.deployedVariantName && d.revision
                        ? `${d.name} · ${d.deployedVariantName} v${d.revision}`
                        : (d.name ?? d.slug ?? ""),
            }))
    }, [playgroundEntityId, environments, appDeployments.data])
    */

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
        const refs = subscription.data?.references
        const envRef = refs?.environment
        if (envRef) {
            setBindMode("environment")
            setEnvironmentSlug(envRef.slug ?? null)
            setAppSlug(refs?.application?.slug ?? null)
        } else {
            setWorkflowRevId(extractBoundWorkflowId(refs))
            // Don't store the raw revision id as the label — resolve a friendly name from
            // the molecule (resolvedRevisionName) for the picker placeholder instead.
            setWorkflowLabel(null)
        }
        setInputsText(
            subscription.data?.inputs_fields
                ? JSON.stringify(subscription.data.inputs_fields, null, 2)
                : DEFAULT_INPUTS_MAPPING,
        )
        if (subscription.data?.trigger_config) {
            configForm.setFieldsValue(subscription.data.trigger_config)
        }
    }, [isEdit, subscription, subFetching, subscriptionId, configForm])

    // Create-mode default-bind to the playground agent (or `defaultReferences`).
    useEffect(() => {
        if (isEdit) return
        const refs = state?.defaultReferences
        setAppSlug(refs?.application?.slug ?? null)
        const variantId = extractBoundRevId(refs) ?? workflowRevId0
        if (!variantId) return
        const appId = refs?.application?.id ?? playgroundWorkflow?.workflow_id ?? null
        const label = state?.defaultBoundLabel ?? playgroundAppName ?? appId ?? variantId
        setWorkflowRevId(variantId)
        setWorkflowLabel(label)
        setWorkflowSelection({
            type: "workflowRevision",
            id: variantId,
            label,
            path: [],
            metadata: {
                workflowId: appId ?? "",
                workflowName: state?.defaultBoundLabel ?? "",
                variantId,
                variantName: "",
                revision: 0,
            },
        })
    }, [isEdit])

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

    const baselineSnapshot = useMemo(() => {
        if (isEdit && subscription) {
            const refs = subscription.data?.references
            const envRef = refs?.environment
            return JSON.stringify({
                name: subscription.name ?? "",
                connectionId: subscription.connection_id ?? null,
                eventKey: subscription.data?.event_key ?? "",
                enabled: isEntityActive(subscription),
                bindMode: envRef ? "environment" : "revision",
                environmentSlug: envRef?.slug ?? null,
                workflowRevId: extractBoundWorkflowId(refs),
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
            bindMode: "revision",
            environmentSlug: null,
            workflowRevId: extractBoundRevId(state?.defaultReferences) ?? workflowRevId0,
            inputs: normalizeJson(DEFAULT_INPUTS_MAPPING),
        })
    }, [isEdit, subscription, state?.connectionId, state?.eventKey])

    const isDirty = useMemo(
        () =>
            baselineSnapshot !==
            JSON.stringify({
                name,
                connectionId: connectionId ?? null,
                eventKey,
                enabled,
                bindMode,
                environmentSlug: environmentSlug ?? null,
                workflowRevId: workflowRevId ?? null,
                inputs: normalizeJson(inputsText),
            }),
        [
            baselineSnapshot,
            name,
            connectionId,
            eventKey,
            enabled,
            bindMode,
            environmentSlug,
            workflowRevId,
            inputsText,
        ],
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
        if (bindMode === "environment" && !environmentSlug) {
            message.error("Select an environment")
            return null
        }
        // Deployed binding resolves via app slug + environment; without the app the reference
        // is ambiguous (an env can host many apps). Fail loud rather than persist it.
        if (bindMode === "environment" && !appSlug) {
            message.error("This trigger isn't linked to an app — use Pinned (a specific revision)")
            return null
        }
        if (bindMode === "revision" && !versionChosen) {
            message.error("Bind a workflow")
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

        const references = buildRunVersionReferences({
            bindMode,
            environmentSlug,
            appSlug,
            workflowSelection,
            workflowRevId,
            fallbackReferences: storedReferences,
        })

        return {
            event_key: eventKey,
            trigger_config: triggerConfig,
            inputs_fields: inputsFields,
            references,
        }
    }, [
        connectionId,
        eventKey,
        bindMode,
        environmentSlug,
        appSlug,
        workflowRevId,
        versionChosen,
        inputsText,
        workflowSelection,
        subscription,
    ])

    const handleSubmit = useCallback(async () => {
        const data = await buildData()
        if (!data || !connectionId) return
        try {
            let savedId: string | null = null
            if (isEdit && subscription) {
                const body: TriggerSubscriptionEdit = {
                    id: subscription.id as string,
                    name: name || null,
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
                    name: name || null,
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
        enabled,
        edit,
        create,
        onClose,
        onSaved,
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

    // Section status + summaries.
    const sourceChosen = !!connectionId && !!eventKey
    const sourceSummary = sourceChosen
        ? eventDetail?.name
            ? `${eventDetail.name}${
                  connectionName(selectedConnection)
                      ? ` · ${connectionName(selectedConnection)}`
                      : ""
              }`
            : eventKey
        : undefined
    const versionSummary =
        bindMode === "revision"
            ? (workflowLabel ?? resolvedRevisionName ?? undefined)
            : environmentSlug
              ? `env: ${environmentSlug}`
              : undefined
    const mappingStatus = inputsError ? "warning" : inputsText.trim() ? "complete" : "default"
    // Create is gated on completeness, not on dirtiness: a trigger seeded from the catalog
    // (connection + event + default binding) already matches its baseline, and gating on
    // `isDirty` would leave Create disabled until the user edited an unrelated field.
    const canSubmit = isEdit ? isDirty : sourceChosen && versionChosen

    // Agent-type-aware mapping target (same split as the schedule composer): chat agents
    // take a `messages` array, completion agents the first string input from their schema.
    const schemaSourceId = playgroundEntityId ?? workflowRevId ?? ""
    // Only agent workflows get the token composer; non-agent bound workflows keep the
    // raw-JSON mapping editor (committed behavior).
    const isAgent = useAtomValue(workflowMolecule.selectors.isAgent(schemaSourceId))
    const isChatInput =
        useAtomValue(workflowMolecule.selectors.executionMode(schemaSourceId)) === "chat"
    const agentInputSchema = useAtomValue(workflowMolecule.selectors.inputSchema(schemaSourceId))
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
        return (
            <div className="flex items-center justify-center py-12">
                <Spinner />
            </div>
        )
    }

    if (browsing) {
        return (
            <SourceBrowsePage
                hidden={hidden}
                connections={connections}
                defaultIntegrationKey={state?.integrationKey}
                onPick={(cid, ek) => {
                    setConnectionId(cid)
                    setEventKey(ek)
                    setBrowsing(false)
                }}
            />
        )
    }

    return (
        <div
            className={`flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden${
                hidden ? " hidden" : ""
            }`}
        >
            <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-4">
                <ConfigAccordionSection
                    size="compact"
                    collapsible={false}
                    icon={<Tag size={15} />}
                    title="Name"
                    status={name.trim() ? "complete" : "default"}
                >
                    <Input
                        placeholder="Trigger name"
                        value={name}
                        onChange={(e) => {
                            setName(e.target.value)
                            onNameChange?.(e.target.value)
                        }}
                    />
                </ConfigAccordionSection>

                <ConfigAccordionSection
                    size="compact"
                    icon={<Lightning size={15} />}
                    title={<RequiredTitle>When this happens</RequiredTitle>}
                    status={sourceChosen ? "complete" : "warning"}
                    summary={sourceSummary}
                    summaryCollapsedOnly
                >
                    <SourceField
                        connections={connections}
                        connectionId={connectionId}
                        eventKey={eventKey}
                        eventName={eventDetail?.name ?? undefined}
                        onBrowse={() => setBrowsing(true)}
                        isEdit={isEdit}
                        triggerConfigSchema={triggerConfigSchema}
                        configForm={configForm}
                        configFormRef={configFormRef}
                    />
                </ConfigAccordionSection>

                <ConfigAccordionSection
                    size="compact"
                    icon={<GitBranch size={15} />}
                    title={<RequiredTitle>Which version runs?</RequiredTitle>}
                    status={versionChosen ? "complete" : "warning"}
                    summary={versionSummary}
                    summaryCollapsedOnly
                >
                    <RunVersionField
                        railWidth="w-[200px]"
                        bindMode={bindMode}
                        onBindModeChange={setBindMode}
                        revisionAdapter={revisionAdapter}
                        revisionPlaceholder={
                            workflowLabel ??
                            resolvedRevisionName ??
                            (playgroundEntityId
                                ? "Select a variant revision"
                                : "Select workflow revision")
                        }
                        onRevisionSelect={(selection) => {
                            setWorkflowRevId(selection.id)
                            setWorkflowSelection(selection)
                            const m = selection.metadata
                            const app = playgroundAppName ?? m.workflowName
                            const segs: string[] = []
                            if (app) segs.push(app)
                            if (m.variantName && m.variantName !== app) segs.push(m.variantName)
                            let label = segs.join(" / ")
                            if (m.revision != null)
                                label = label ? `${label} · v${m.revision}` : `v${m.revision}`
                            setWorkflowLabel(label || selection.label)
                        }}
                        hideEnvironment
                        /* Deployed option temporarily hidden — drop `hideEnvironment`
                               and uncomment to restore.
                            envOptions={envOptions}
                            envLoading={
                                playgroundEntityId ? appDeployments.isLoading : envQuery.isLoading
                            }
                            environmentSlug={environmentSlug}
                            onEnvironmentChange={setEnvironmentSlug}
                            envNotFound={
                                playgroundEntityId
                                    ? "This agent isn't deployed to any environment yet."
                                    : undefined
                            }
                            */
                    />
                </ConfigAccordionSection>

                <ConfigAccordionSection
                    size="compact"
                    icon={<FlowArrow size={15} />}
                    title="What the agent gets"
                    status={mappingStatus}
                    summaryCollapsedOnly
                >
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
                        isChat={isChatInput}
                        primaryKey={primaryInputKey}
                    />
                </ConfigAccordionSection>
            </div>

            <DrawerFooter
                enabled={enabled}
                onEnabledChange={setEnabled}
                onCancel={onClose}
                run={
                    playgroundEntityId ? (
                        <RunSubscriptionButton
                            playgroundEntityId={playgroundEntityId}
                            name={name}
                            eventKey={eventKey}
                            disabled={!isEdit}
                            onClose={onClose}
                        />
                    ) : undefined
                }
                isMutating={isMutating}
                canSave={canSubmit && !alreadySubscribed}
                submitLabel={isEdit ? "Save" : "Create"}
                onSubmit={handleSubmit}
            />
        </div>
    )
}
