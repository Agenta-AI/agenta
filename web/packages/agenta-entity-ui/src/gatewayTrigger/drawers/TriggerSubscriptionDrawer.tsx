import {useCallback, useEffect, useMemo, useRef, useState, type ReactNode} from "react"

import {
    appEnvironmentsQueryAtomFamily,
    environmentsListQueryAtomFamily,
} from "@agenta/entities/environment"
import {
    compileMessageTemplate,
    getScheduleMessagePreview,
    isConnectionActive,
    isEntityActive,
    isEntityValid,
    parseMessageTemplate,
    previewValue,
    resolveSelectorPreview,
    splitTemplate,
    testTriggerSubscription,
    triggerApiErrorMessage,
    triggerSubscriptionDrawerAtom,
    useTriggerCatalogEvents,
    useTriggerCatalogIntegrations,
    useTriggerConnectionsQuery,
    useTriggerEvent,
    useTriggerSubscription,
    useTriggerSubscriptions,
    type SubscriptionDrawerState,
    type TriggerCatalogIntegration,
    type TriggerConnection,
    type TriggerSubscription,
    type TriggerSubscriptionCreate,
    type TriggerSubscriptionData,
    type TriggerSubscriptionEdit,
} from "@agenta/entities/gatewayTrigger"
import {extractInputPortsFromSchema} from "@agenta/entities/runnable"
import {appWorkflowsListQueryStateAtom, workflowMolecule} from "@agenta/entities/workflow"
import {simulatedAgentRunAtomFamily} from "@agenta/shared/state"
import {dayjs} from "@agenta/shared/utils"
import {message, ScrollSentinel} from "@agenta/ui"
import {ConfigAccordionSection} from "@agenta/ui/components/presentational"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {Editor} from "@agenta/ui/editor"
import {
    ArrowLeft,
    FlowArrow,
    GitBranch,
    Lightning,
    MagnifyingGlass,
    PencilSimple,
    Plugs,
    Plus,
    Tag,
} from "@phosphor-icons/react"
import {Button, Form, Input, Modal, Spin, Tooltip, Typography} from "antd"
import {atom, useAtom, useAtomValue, useSetAtom} from "jotai"
import Image from "next/image"

import SchemaForm, {type SchemaFormHandle} from "../../gatewayTool/components/SchemaForm"
import {createWorkflowRevisionAdapter, type WorkflowRevisionSelectionResult} from "../../selection"

import {loadRecentSamples, waitForNewDelivery} from "./shared/deliveries"
import {EventSourcePicker, type SampledEvent} from "./shared/EventSourcePicker"
import {RunVersionField, buildRunVersionReferences} from "./shared/RunVersionField"
import {TriggerDrawerFooter} from "./shared/TriggerDrawerFooter"
import {DraftListRow, EntityListRow, TriggerListRail, isDraftId} from "./shared/TriggerListRail"
import {useDraftMasterDetail} from "./shared/useDraftMasterDetail"
import TriggerConnectDrawer from "./TriggerConnectDrawer"

// How many unsaved drafts can exist at once (config knob; see schedule drawer).
const MAX_DRAFTS = 5
// Show the master-detail list rail (existing triggers + "New trigger"). Hidden for now —
// the playground opens straight to a single form; flip back to true to restore the list.
const SHOW_LIST_RAIL = false

// The active form publishes its source-browse state here so the single drawer header can go
// "smart" (back + "Choose a trigger") without lifting browse state out of the form.
const browseHeaderAtom = atom<{onBack: () => void} | null>(null)
// The master-detail content publishes whether the open form is a SAVED subscription (vs a new
// draft) so the root title reads "Edit trigger" after a create switches to the saved id —
// `state.subscriptionId` alone stays undefined in the playground create flow.
const subscriptionEditingAtom = atom(false)
// Default maps the whole event context under `context`; `$` resolves to the full context.
const DEFAULT_INPUTS_MAPPING = '{"context": "$"}'

// The bound reference is always `application_*`, so the picker only offers application
// workflows (is_application=True).
const applicationRevisionAdapter = createWorkflowRevisionAdapter({
    workflowListAtom: appWorkflowsListQueryStateAtom,
})

// Section title with a trailing required marker.
function RequiredTitle({children}: {children: ReactNode}) {
    return (
        <>
            {children}
            <span className="ml-1 text-[var(--ag-colorError)]">*</span>
        </>
    )
}

function normalizeJson(text: string): string {
    try {
        return JSON.stringify(JSON.parse(text))
    } catch {
        return text
    }
}

// The bound revision id can live under any of three reference keys depending on how the
// subscription was created. Read all three from one place so write/read keys can't drift.
function extractBoundRevId(
    refs: Record<string, {id?: string | null} | null | undefined> | null | undefined,
): string | null {
    return (
        refs?.application_revision?.id ??
        refs?.application_variant?.id ??
        refs?.workflow_revision?.id ??
        null
    )
}

// ---------------------------------------------------------------------------
// TriggerSubscriptionDrawer (root) — create or edit a provider-event subscription.
//
// Mirrors the schedule drawer: from a playground it's a master-detail manager
// (existing subscriptions on the left, config on the right, a persistent "Run in
// playground" in the footer); from settings it's a single create/edit form.
// EnhancedDrawer renders nothing until first open, so SubscriptionDrawerContent —
// which owns all data fetching + master-detail state — only mounts while open.
// ---------------------------------------------------------------------------

export default function TriggerSubscriptionDrawer() {
    const [state, setState] = useAtom(triggerSubscriptionDrawerAtom)
    const open = !!state
    const handleClose = useCallback(() => setState(null), [setState])

    const playgroundEntityId = state?.playgroundEntityId
    // Smart header: while the active form is browsing for a source, the header becomes a
    // back affordance + "Choose a trigger"; otherwise it's the form title.
    const browseHeader = useAtomValue(browseHeaderAtom)
    // Editing = opened on a saved id OR the master-detail switched to one (e.g. after create).
    const editing = useAtomValue(subscriptionEditingAtom)
    const formTitle =
        SHOW_LIST_RAIL && playgroundEntityId
            ? "Triggers"
            : state?.subscriptionId || editing
              ? "Edit trigger"
              : "New trigger"
    const title = browseHeader ? (
        <span className="flex items-center gap-3">
            <button
                type="button"
                onClick={browseHeader.onBack}
                className="flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-xs font-normal text-[var(--ag-colorTextSecondary)] hover:text-[var(--ag-colorText)]"
            >
                <ArrowLeft size={15} /> Back
            </button>
            <span>Choose a trigger</span>
        </span>
    ) : (
        formTitle
    )

    return (
        <EnhancedDrawer
            open={open}
            onClose={handleClose}
            title={title}
            closable={!browseHeader}
            width={playgroundEntityId ? 960 : 640}
            closeOnLayoutClick={false}
            styles={{
                body: {padding: 0, display: "flex", flexDirection: "column", overflow: "hidden"},
            }}
        >
            {state && <SubscriptionDrawerContent state={state} onClose={handleClose} />}
        </EnhancedDrawer>
    )
}

// ---------------------------------------------------------------------------
// SubscriptionDrawerContent — data fetching + master-detail business logic,
// mounted only while open. Playground = master-detail; settings = single form.
// ---------------------------------------------------------------------------

function SubscriptionDrawerContent({
    state,
    onClose,
}: {
    state: SubscriptionDrawerState
    onClose: () => void
}) {
    const playgroundEntityId = state.playgroundEntityId
    const {subscriptions: allSubscriptions, isLoading: subsLoading} = useTriggerSubscriptions()
    const {remove: deleteSubscriptionApi} = useTriggerSubscription()

    // Scope the list to subscriptions linked to this agent's WORKFLOW (id + app slug).
    const playgroundData = useAtomValue(workflowMolecule.selectors.data(playgroundEntityId ?? ""))
    const subscriptions = useMemo(() => {
        if (!playgroundEntityId) return allSubscriptions
        const workflowId = playgroundData?.workflow_id ?? playgroundEntityId
        const appSlug = (playgroundData as {slug?: string} | null)?.slug
        return allSubscriptions.filter((s) => {
            const refs = s.data?.references
            if (!refs) return false
            return Object.values(refs).some(
                (r) => (!!r?.id && r.id === workflowId) || (!!appSlug && r?.slug === appSlug),
            )
        })
    }, [allSubscriptions, playgroundEntityId, playgroundData])

    const onDeleteSubscription = useCallback(
        async (subscriptionId: string): Promise<boolean> => {
            try {
                await deleteSubscriptionApi(subscriptionId)
            } catch {
                message.error("Failed to delete trigger")
                return false
            }
            message.success("Trigger deleted")
            return true
        },
        [deleteSubscriptionApi],
    )

    const {
        selectedId,
        setSelectedId,
        drafts,
        draftNames,
        canCreate,
        handleNew,
        setDraftName,
        handleDraftSaved,
        removeDraft,
        deleteEntity,
    } = useDraftMasterDetail({
        initialId: state.subscriptionId,
        entities: subscriptions,
        maxDrafts: MAX_DRAFTS,
        onDelete: onDeleteSubscription,
    })

    // Publish whether the open form is a saved subscription so the root title reflects it
    // (after a create, selectedId switches to the saved id while state.subscriptionId stays unset).
    const setEditing = useSetAtom(subscriptionEditingAtom)
    useEffect(() => {
        setEditing(!!selectedId && !isDraftId(selectedId))
        return () => setEditing(false)
    }, [selectedId, setEditing])

    if (!playgroundEntityId) {
        return (
            <SubscriptionForm
                key={state.subscriptionId ?? "new"}
                subscriptionId={state.subscriptionId}
                onClose={onClose}
            />
        )
    }

    return (
        <div className="flex h-full min-h-0 w-full overflow-hidden">
            {SHOW_LIST_RAIL && (
                <SubscriptionsList
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    onNew={handleNew}
                    drafts={drafts}
                    draftNames={draftNames}
                    canCreate={canCreate}
                    subscriptions={subscriptions}
                    isLoading={subsLoading}
                    onRemoveDraft={removeDraft}
                    onDeleteSubscription={deleteEntity}
                />
            )}
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                {drafts.map((draftId) => (
                    <SubscriptionForm
                        key={draftId}
                        subscriptionId={undefined}
                        onClose={onClose}
                        hidden={selectedId !== draftId}
                        onNameChange={(name) => setDraftName(draftId, name)}
                        onSaved={(savedId) => handleDraftSaved(draftId, savedId)}
                    />
                ))}
                {selectedId && !isDraftId(selectedId) && (
                    <SubscriptionForm
                        key={selectedId}
                        subscriptionId={selectedId}
                        onClose={onClose}
                        onSaved={setSelectedId}
                    />
                )}
            </div>
        </div>
    )
}

// ---------------------------------------------------------------------------
// SubscriptionsList — master-detail left rail (reuses TriggerListRail).
// ---------------------------------------------------------------------------

function SubscriptionsList({
    selectedId,
    onSelect,
    onNew,
    drafts,
    draftNames,
    canCreate,
    subscriptions,
    isLoading,
    onRemoveDraft,
    onDeleteSubscription,
}: {
    selectedId?: string
    onSelect: (id?: string) => void
    onNew: () => void
    drafts: string[]
    draftNames: Record<string, string>
    canCreate: boolean
    subscriptions: TriggerSubscription[]
    isLoading: boolean
    onRemoveDraft: (id: string) => void
    onDeleteSubscription: (id: string) => void
}) {
    const [modal, modalContextHolder] = Modal.useModal()

    const confirmRemoveDraft = (draftId: string, name: string) =>
        modal.confirm({
            title: "Discard draft?",
            content: name.trim()
                ? `"${name.trim()}" hasn't been saved. Discard it?`
                : "This draft hasn't been saved.",
            okText: "Discard",
            okButtonProps: {danger: true},
            cancelText: "Cancel",
            onOk: () => onRemoveDraft(draftId),
        })

    const confirmDelete = (subscription: TriggerSubscription) =>
        modal.confirm({
            title: "Delete trigger?",
            content: `This permanently deletes ${subscription.name ? `"${subscription.name}"` : "this trigger"}.`,
            okText: "Delete",
            okButtonProps: {danger: true},
            cancelText: "Cancel",
            onOk: () => subscription.id && onDeleteSubscription(subscription.id),
        })

    return (
        <TriggerListRail
            newLabel="New trigger"
            onNew={onNew}
            canCreate={canCreate}
            isLoading={isLoading}
            isEmpty={subscriptions.length === 0 && drafts.length === 0}
            emptyText="No triggers yet."
        >
            {modalContextHolder}
            {drafts.map((draftId) => (
                <DraftListRow
                    key={draftId}
                    active={selectedId === draftId}
                    name={draftNames[draftId] ?? ""}
                    draftLabel="Untitled trigger"
                    onClick={() => onSelect(draftId)}
                    onRemove={() => confirmRemoveDraft(draftId, draftNames[draftId] ?? "")}
                />
            ))}
            {subscriptions.map((s) => {
                const named = !!s.name?.trim()
                const message = getScheduleMessagePreview(s.data?.inputs_fields)
                return (
                    <EntityListRow
                        key={s.id}
                        active={!!s.id && s.id === selectedId}
                        running={isEntityActive(s)}
                        title={named ? (s.name as string) : "Untitled trigger"}
                        titleMuted={!named}
                        subtitle={s.data?.event_key || message || "App subscription"}
                        onClick={() => onSelect(s.id ?? undefined)}
                        onRemove={s.id ? () => confirmDelete(s) : undefined}
                    />
                )
            })}
        </TriggerListRail>
    )
}

// ---------------------------------------------------------------------------
// SubscriptionForm — the sectioned config (mirrors the schedule form sections):
// Name / When this happens / Which version runs? / What the agent gets, + footer.
// ---------------------------------------------------------------------------

function SubscriptionForm({
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

    const [configForm] = Form.useForm()
    const configFormRef = useRef<SchemaFormHandle>(null)

    // Prefill from the freshly-fetched subscription (edit mode).
    useEffect(() => {
        if (!isEdit || !subscription) return
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
            const wfId = extractBoundRevId(refs)
            setWorkflowRevId(wfId)
            // Don't store the raw revision id as the label — resolve a friendly name from
            // the molecule (resolvedRevisionName) for the picker placeholder instead.
            setWorkflowLabel(null)
        }
        setInputsText(
            subscription.data?.inputs_fields
                ? JSON.stringify(subscription.data.inputs_fields, null, 2)
                : DEFAULT_INPUTS_MAPPING,
        )
    }, [isEdit, subscription])

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

    useEffect(() => {
        if (isEdit && subscription?.data?.trigger_config) {
            configForm.setFieldsValue(subscription.data.trigger_config)
        }
    }, [isEdit, subscription, configForm])

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
                workflowRevId: extractBoundRevId(refs),
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
        if (bindMode === "revision" && !workflowRevId) {
            message.error("Bind a workflow")
            return null
        }

        let inputsFields: Record<string, unknown> | string = {}
        try {
            inputsFields = inputsText.trim() ? JSON.parse(inputsText) : {}
            setInputsError(null)
        } catch {
            setInputsError("Invalid JSON")
            message.error("inputs mapping is not valid JSON")
            return null
        }

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
            fallbackReferences: subscription?.data?.references,
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
            if (onSaved && savedId) onSaved(savedId)
            else onClose()
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
            .catch(() => {})
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
            return {
                id: res.delivery.id ?? "live",
                label: sampleLabel,
                preview: getScheduleMessagePreview(payload) || undefined,
                timeAgo: "just now",
                payload,
            }
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
    const versionChosen = bindMode === "revision" ? !!workflowRevId : !!environmentSlug
    const versionSummary =
        bindMode === "revision"
            ? (workflowLabel ?? resolvedRevisionName ?? undefined)
            : environmentSlug
              ? `env: ${environmentSlug}`
              : undefined
    const mappingStatus = inputsError ? "warning" : inputsText.trim() ? "complete" : "default"

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
                <Spin />
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
                <Form layout="vertical">
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
                            isChat={isChatInput}
                            primaryKey={primaryInputKey}
                        />
                    </ConfigAccordionSection>
                </Form>
            </div>

            <TriggerDrawerFooter
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
                canSave={isDirty && !alreadySubscribed}
                submitLabel={isEdit ? "Save" : "Create"}
                onSubmit={handleSubmit}
            />
        </div>
    )
}

// ---------------------------------------------------------------------------
// SourceField — connection + event selection and the event-config schema. This
// is the subscription analog of the schedule's cron builder ("when").
// ---------------------------------------------------------------------------

function connectionName(conn: TriggerConnection | undefined): string {
    return conn?.name || conn?.slug || conn?.integration_key || ""
}

// An app's logo (catalog `integration.logo`), with a neutral plug fallback.
function AppLogo({logo, size = 20}: {logo?: string | null; size?: number}) {
    if (!logo) return <Plugs size={size} className="shrink-0 text-[var(--ag-colorTextSecondary)]" />
    return (
        <Image
            src={logo}
            alt=""
            width={size}
            height={size}
            unoptimized
            className="shrink-0 rounded object-contain"
        />
    )
}

// SourceField (in the section): the CHOSEN source as a 2-panel summary (source on the
// left rail + its event filters on the right), or a CTA when nothing is chosen. The actual
// app/event selection happens on the full SourceBrowsePage (opened via `onBrowse`).
function SourceField({
    connections,
    connectionId,
    eventKey,
    eventName,
    onBrowse,
    isEdit,
    triggerConfigSchema,
    configForm,
    configFormRef,
}: {
    connections: TriggerConnection[]
    connectionId?: string
    eventKey: string
    eventName?: string
    onBrowse: () => void
    isEdit: boolean
    triggerConfigSchema: Record<string, unknown> | null
    configForm: ReturnType<typeof Form.useForm>[0]
    configFormRef: React.RefObject<SchemaFormHandle | null>
}) {
    const {integrations} = useTriggerCatalogIntegrations()
    const byKey = useMemo(() => {
        const m = new Map<string, TriggerCatalogIntegration>()
        integrations.forEach((i) => m.set(i.key, i))
        return m
    }, [integrations])

    if (!eventKey) {
        return (
            <button
                type="button"
                onClick={onBrowse}
                className="box-border flex w-full cursor-pointer items-center gap-2.5 rounded-lg border border-dashed border-[var(--ag-colorBorder)] bg-transparent px-3 py-3 text-left hover:border-[var(--ag-colorPrimary)]"
            >
                <Plus size={16} className="shrink-0 text-[var(--ag-colorTextSecondary)]" />
                <span className="flex-1 text-xs text-[var(--ag-colorTextSecondary)]">
                    Choose a connected app and the event that fires this trigger
                </span>
                <span className="text-[11px] text-[var(--ag-colorTextTertiary)]">→</span>
            </button>
        )
    }

    const selected = connections.find((c) => c.id === connectionId)
    const logo = selected ? byKey.get(selected.integration_key)?.logo : undefined
    return (
        <div className="flex gap-3">
            <div className="flex w-[200px] shrink-0 flex-col">
                <button
                    type="button"
                    onClick={onBrowse}
                    disabled={isEdit}
                    title={isEdit ? undefined : "Change trigger"}
                    className="group flex items-start gap-2.5 rounded-lg border border-solid border-[var(--ag-colorBorder)] bg-transparent px-3 py-2 text-left enabled:cursor-pointer enabled:hover:border-[var(--ag-colorPrimary)]"
                >
                    <AppLogo logo={logo} size={20} />
                    <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium">{eventName || eventKey}</div>
                        <div className="truncate text-[11px] text-[var(--ag-colorTextTertiary)]">
                            via {connectionName(selected) || "connection"}
                        </div>
                    </div>
                    {!isEdit && (
                        <PencilSimple
                            size={14}
                            className="mt-0.5 shrink-0 text-[var(--ag-colorTextTertiary)] opacity-0 transition-opacity group-hover:opacity-100"
                        />
                    )}
                </button>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 border-0 border-l border-solid border-[var(--ag-colorBorderSecondary)] pl-3">
                <Typography.Text type="secondary" className="!text-[11px] leading-snug">
                    Event filters
                </Typography.Text>
                {triggerConfigSchema ? (
                    <div className="max-w-prose">
                        <SchemaForm
                            ref={configFormRef}
                            form={configForm}
                            schema={triggerConfigSchema}
                            flat
                        />
                    </div>
                ) : (
                    <Typography.Text type="secondary" className="!text-[11px]">
                        No filters for this event.
                    </Typography.Text>
                )}
            </div>
        </div>
    )
}

// SourceBrowsePage — full-context source selection within the drawer (not inlined in the
// section): the app rail + detail/connect chooser. The "back" affordance lives in the smart
// drawer header (see browseHeaderAtom). Picking an event returns to the form with the source.
function SourceBrowsePage({
    hidden,
    connections,
    defaultIntegrationKey,
    onPick,
}: {
    hidden?: boolean
    connections: TriggerConnection[]
    defaultIntegrationKey?: string
    onPick: (connectionId: string, eventKey: string) => void
}) {
    return (
        <div
            className={`flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden${
                hidden ? " hidden" : ""
            }`}
        >
            <div className="min-h-0 flex-1 overflow-hidden px-6 py-4">
                <SourceChooser
                    connections={connections}
                    defaultIntegrationKey={defaultIntegrationKey}
                    onPick={onPick}
                />
            </div>
        </div>
    )
}

// SourceChooser — your connected accounts on the left (only when you have any), and a grid
// of larger app cards filling the right (popular by default, searchable across all). The
// right is always populated — no dead empty state. Selecting an app/account drills into its
// events (or a connect invite), with an "← All apps" return.
function SourceChooser({
    connections,
    defaultIntegrationKey,
    onPick,
}: {
    connections: TriggerConnection[]
    defaultIntegrationKey?: string
    onPick: (connectionId: string, eventKey: string) => void
}) {
    const {integrations, hasNextPage, isFetchingNextPage, isLoading, requestMore, setSearch} =
        useTriggerCatalogIntegrations()
    const byKey = useMemo(() => {
        const m = new Map<string, TriggerCatalogIntegration>()
        integrations.forEach((i) => m.set(i.key, i))
        return m
    }, [integrations])
    const connectedKeys = useMemo(
        () => new Set(connections.map((c) => c.integration_key)),
        [connections],
    )

    const [searchInput, setSearchInput] = useState("")
    useEffect(() => {
        const t = setTimeout(() => setSearch(searchInput), 250)
        return () => clearTimeout(t)
    }, [searchInput, setSearch])
    const searching = searchInput.trim().length > 0
    // The grid shows every app with infinite scroll (the catalog returns popular ones first);
    // searching filters the list server-side.
    const gridItems = integrations

    // Selection is a specific connection (an account) or an integration (browse). Null = the
    // app grid (the default — never an empty panel). A `defaultIntegrationKey` (e.g. opened via
    // a provider group's "+") drills straight into that provider.
    const [selected, setSelected] = useState<{kind: "conn" | "intg"; id: string} | null>(
        defaultIntegrationKey ? {kind: "intg", id: defaultIntegrationKey} : null,
    )
    // Callback-ref state for the grid's scroll container, so ScrollSentinel can observe
    // against it (a ref wouldn't re-render the sentinel once the element mounts).
    const [gridEl, setGridEl] = useState<HTMLDivElement | null>(null)
    // Resolve to a connection: a chosen account directly, or — for a chosen integration —
    // its first connection if one exists. So once a connect completes and the list refetches,
    // the right panel flips from the connect invite to that account's events automatically.
    const selectedConn =
        selected?.kind === "conn"
            ? connections.find((c) => c.id === selected.id)
            : selected?.kind === "intg"
              ? connections.find((c) => c.integration_key === selected.id)
              : undefined
    const selectedIntegration = selectedConn
        ? byKey.get(selectedConn.integration_key)
        : selected?.kind === "intg"
          ? byKey.get(selected.id)
          : undefined
    const [connectIntegration, setConnectIntegration] = useState<TriggerCatalogIntegration | null>(
        null,
    )

    const hasConnections = connections.length > 0

    return (
        <div className="flex h-full min-h-[260px] gap-3">
            {hasConnections && (
                <div className="flex w-[220px] shrink-0 flex-col gap-0.5 overflow-y-auto">
                    <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-[var(--ag-colorTextTertiary)]">
                        Your connections
                    </div>
                    {connections.map((c) => {
                        const app = byKey.get(c.integration_key)
                        const appName = app?.name ?? c.integration_key
                        // Lead with the connection's own name so multiple accounts of the
                        // same provider are distinct.
                        const account = c.name?.trim()
                        return (
                            <AppRailItem
                                key={c.id ?? c.integration_key}
                                active={selected?.kind === "conn" && selected.id === c.id}
                                logo={app?.logo}
                                name={account || appName}
                                sub={account ? appName : undefined}
                                connected
                                onClick={() => c.id && setSelected({kind: "conn", id: c.id})}
                            />
                        )
                    })}
                </div>
            )}

            <div
                className={`flex min-h-0 min-w-0 flex-1 flex-col ${
                    hasConnections
                        ? "border-0 border-l border-solid border-[var(--ag-colorBorderSecondary)] pl-3"
                        : ""
                }`}
            >
                {selected ? (
                    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                        <button
                            type="button"
                            onClick={() => setSelected(null)}
                            className="mb-2 flex cursor-pointer items-center gap-1 self-start border-0 bg-transparent p-0 text-[11px] text-[var(--ag-colorTextSecondary)] hover:text-[var(--ag-colorText)]"
                        >
                            <ArrowLeft size={13} /> All apps
                        </button>
                        {selectedConn ? (
                            <>
                                <ConnectionDetail
                                    connection={selectedConn}
                                    integration={selectedIntegration}
                                />
                                <div className="mb-1 mt-2 flex items-center justify-between gap-2">
                                    <Typography.Text
                                        type="secondary"
                                        className="!text-[11px] leading-snug"
                                    >
                                        Choose an event
                                    </Typography.Text>
                                    {selectedIntegration && (
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setConnectIntegration(selectedIntegration)
                                            }
                                            className="cursor-pointer border-0 bg-transparent p-0 text-[11px] text-[var(--ag-colorPrimary)] hover:underline"
                                        >
                                            + Connect another account
                                        </button>
                                    )}
                                </div>
                                <ConnectionEventList
                                    integrationKey={selectedConn.integration_key}
                                    onPick={(ek) => onPick(selectedConn.id as string, ek)}
                                />
                            </>
                        ) : (
                            <ConnectInvite
                                integration={selectedIntegration}
                                onConnect={() =>
                                    selectedIntegration &&
                                    setConnectIntegration(selectedIntegration)
                                }
                            />
                        )}
                    </div>
                ) : (
                    <>
                        <Input
                            allowClear
                            placeholder="Search apps…"
                            prefix={
                                <MagnifyingGlass
                                    size={13}
                                    className="text-[var(--ag-colorTextTertiary)]"
                                />
                            }
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                        />
                        <div className="mb-1 mt-2 px-0.5 text-[10px] uppercase tracking-wide text-[var(--ag-colorTextTertiary)]">
                            {searching ? "Search results" : "All apps"}
                        </div>
                        <div
                            ref={setGridEl}
                            className="grid min-h-0 flex-1 auto-rows-min gap-2 overflow-y-auto [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]"
                        >
                            {gridItems.map((i) => (
                                <AppCard
                                    key={i.key}
                                    logo={i.logo}
                                    name={i.name}
                                    description={i.description}
                                    categories={i.categories}
                                    actionsCount={i.actions_count}
                                    connected={connectedKeys.has(i.key)}
                                    onClick={() => setSelected({kind: "intg", id: i.key})}
                                />
                            ))}
                            {!isLoading && gridItems.length === 0 && (
                                <div className="col-span-full py-6 text-center text-[11px] text-[var(--ag-colorTextTertiary)]">
                                    {searching
                                        ? `No apps match “${searchInput}”.`
                                        : "No apps found."}
                                </div>
                            )}
                            {/* IntersectionObserver prefetch, observed against the grid's own
                                scroll container with a big bottom margin so it loads the next
                                page well before the user reaches the bottom. Re-fires after each
                                fetch (effect depends on isFetching), filling short grids too. */}
                            <div className="col-span-full">
                                {(isLoading || isFetchingNextPage) && (
                                    <div className="flex justify-center py-3">
                                        <Spin size="small" />
                                    </div>
                                )}
                                <ScrollSentinel
                                    onVisible={requestMore}
                                    hasMore={hasNextPage}
                                    isFetching={isFetchingNextPage}
                                    root={gridEl}
                                    rootMargin="0px 0px 1600px 0px"
                                />
                            </div>
                        </div>
                    </>
                )}
            </div>

            {connectIntegration && (
                <TriggerConnectDrawer
                    open={!!connectIntegration}
                    integrationKey={connectIntegration.key}
                    integrationName={connectIntegration.name}
                    integrationLogo={connectIntegration.logo ?? undefined}
                    integrationDescription={connectIntegration.description ?? undefined}
                    authSchemes={connectIntegration.auth_schemes ?? []}
                    onClose={() => setConnectIntegration(null)}
                    onSuccess={() => setConnectIntegration(null)}
                />
            )}
        </div>
    )
}

// A larger app card for the discover grid: logo + name (+ connected hint).
function AppCard({
    logo,
    name,
    description,
    categories,
    actionsCount,
    connected,
    onClick,
}: {
    logo?: string | null
    name: string
    description?: string | null
    categories?: string[]
    actionsCount?: number | null
    connected?: boolean
    onClick: () => void
}) {
    const shownCategories = (categories ?? []).filter(Boolean).slice(0, 2)
    return (
        <button
            type="button"
            onClick={onClick}
            className="group flex h-full min-h-[112px] cursor-pointer flex-col gap-2 rounded-lg border border-solid border-[var(--ag-colorBorder)] bg-transparent p-3 text-left hover:border-[var(--ag-colorPrimary)] hover:bg-[var(--ag-colorFillQuaternary)]"
        >
            <div className="flex items-center gap-2.5">
                <AppLogo logo={logo} size={28} />
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span className="truncate text-xs font-medium">{name}</span>
                    {connected && (
                        <Tooltip title="Connected">
                            <span className="size-1.5 shrink-0 rounded-full bg-[var(--ag-colorSuccess)]" />
                        </Tooltip>
                    )}
                </div>
            </div>
            {description ? (
                <p className="m-0 line-clamp-2 text-[11px] leading-snug text-[var(--ag-colorTextSecondary)]">
                    {description}
                </p>
            ) : (
                <span className="flex-1" />
            )}
            <div className="mt-auto flex items-center gap-1.5">
                {shownCategories.map((cat) => (
                    <span
                        key={cat}
                        className="truncate rounded bg-[var(--ag-colorFillTertiary)] px-1.5 py-0.5 text-[10px] capitalize leading-none text-[var(--ag-colorTextSecondary)]"
                    >
                        {cat}
                    </span>
                ))}
                {typeof actionsCount === "number" && actionsCount > 0 && (
                    <span className="ml-auto flex shrink-0 items-center gap-1 text-[10px] text-[var(--ag-colorTextTertiary)]">
                        <Lightning size={11} weight="fill" />
                        {actionsCount}
                    </span>
                )}
            </div>
        </button>
    )
}

// Richer detail for a connected app: account label, status, and connected date.
function ConnectionDetail({
    connection,
    integration,
}: {
    connection: TriggerConnection
    integration?: TriggerCatalogIntegration
}) {
    const active = isConnectionActive(connection)
    const account = connection.name || connection.slug || ""
    const connectedAt = connection.created_at
        ? dayjs(connection.created_at).format("MMM D, YYYY")
        : ""
    return (
        <div className="flex items-center gap-2.5 rounded-lg border border-solid border-[var(--ag-colorBorder)] px-3 py-2">
            <AppLogo logo={integration?.logo} size={20} />
            <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium">
                    {integration?.name ?? connection.integration_key}
                </div>
                <div className="truncate text-[11px] text-[var(--ag-colorTextTertiary)]">
                    {account || connection.integration_key}
                    {connectedAt ? ` · connected ${connectedAt}` : ""}
                </div>
            </div>
            <span
                className={`inline-flex shrink-0 items-center gap-1 text-[11px] ${
                    active ? "text-[var(--ag-colorSuccess)]" : "text-[var(--ag-colorTextTertiary)]"
                }`}
            >
                <span
                    className={`h-1.5 w-1.5 rounded-full ${
                        active
                            ? "bg-[var(--ag-colorSuccess)]"
                            : "bg-[var(--ag-colorTextQuaternary)]"
                    }`}
                />
                {active ? "Active" : "Inactive"}
            </span>
        </div>
    )
}

function AppRailItem({
    active,
    logo,
    name,
    sub,
    connected,
    onClick,
}: {
    active: boolean
    logo?: string | null
    name: string
    sub?: string
    connected?: boolean
    onClick: () => void
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex w-full cursor-pointer items-center gap-2 rounded border-0 px-2 py-1.5 text-left ${
                active
                    ? "bg-[var(--ag-colorPrimaryBg)]"
                    : "bg-transparent hover:bg-[var(--ag-colorFillTertiary)]"
            }`}
        >
            <AppLogo logo={logo} size={18} />
            <span className="min-w-0 flex-1">
                <span
                    className={`block truncate text-xs ${
                        active
                            ? "font-medium text-[var(--ag-colorPrimary)]"
                            : "text-[var(--ag-colorText)]"
                    }`}
                >
                    {name}
                </span>
                {sub && (
                    <span className="block truncate text-[10px] text-[var(--ag-colorTextTertiary)]">
                        {sub}
                    </span>
                )}
            </span>
            {connected && (
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--ag-colorSuccess)]" />
            )}
        </button>
    )
}

// Invite to connect a not-yet-connected app (logo + name + blurb + connect CTA).
function ConnectInvite({
    integration,
    onConnect,
}: {
    integration?: TriggerCatalogIntegration
    onConnect: () => void
}) {
    return (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
            <AppLogo logo={integration?.logo} size={32} />
            <div className="text-xs font-medium">{integration?.name ?? "This app"}</div>
            {integration?.description && (
                <div className="max-w-[280px] text-[11px] leading-snug text-[var(--ag-colorTextTertiary)]">
                    {integration.description}
                </div>
            )}
            <Button type="primary" onClick={onConnect}>
                Connect {integration?.name ?? "app"}
            </Button>
        </div>
    )
}

function ConnectionEventList({
    integrationKey,
    onPick,
}: {
    integrationKey: string
    onPick: (eventKey: string) => void
}) {
    const {events, isLoading, hasNextPage, requestMore} = useTriggerCatalogEvents(integrationKey)
    if (isLoading && events.length === 0) {
        return (
            <div className="flex justify-center py-3">
                <Spin size="small" />
            </div>
        )
    }
    if (events.length === 0) {
        return (
            <div className="px-3 py-2 text-[11px] text-[var(--ag-colorTextTertiary)]">
                No events for this app
            </div>
        )
    }
    return (
        <div className="flex max-h-[220px] flex-col gap-0.5 overflow-y-auto p-1">
            {events.map((ev) => (
                <button
                    key={ev.key}
                    type="button"
                    onClick={() => onPick(ev.key)}
                    className="flex w-full cursor-pointer items-center gap-2 rounded border-0 bg-transparent px-2 py-1.5 text-left hover:bg-[var(--ag-colorFillSecondary)]"
                >
                    <Lightning size={13} className="shrink-0 text-[var(--ag-colorTextTertiary)]" />
                    <span className="min-w-0 flex-1 truncate text-[12.5px]">
                        {ev.name || ev.key}
                    </span>
                    <Plus size={13} className="shrink-0 text-[var(--ag-colorTextTertiary)]" />
                </button>
            ))}
            {hasNextPage && (
                <button
                    type="button"
                    onClick={requestMore}
                    className="flex w-full cursor-pointer border-0 bg-transparent px-2 py-1.5 text-left text-[12px] text-[var(--ag-colorTextSecondary)] hover:bg-[var(--ag-colorFillSecondary)]"
                >
                    Load more…
                </button>
            )}
        </div>
    )
}

// ---------------------------------------------------------------------------
// MappingSection — map the live event payload into the agent's inputs. "Get a
// sample event" pulls a real event (EventSourcePicker) so selectors preview
// against concrete data. Each leaf string is a selector resolved at delivery.
// ---------------------------------------------------------------------------

// Friendly label for a selector pill/field row: "$.event.attributes.message_user" → "Message user".
function selectorLabel(selector: string): string {
    if (selector === "$" || selector === "$.") return "Full event"
    const tail = selector.split(".").pop() || selector
    const words = tail.replace(/_+/g, " ").trim()
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : selector
}

// Pill-style composer: a contenteditable where `{{token}}` segments render as inline,
// atomic chips (friendly labels). Source of truth is the template string; it re-renders
// the DOM only when `value` changes from outside (not on the user's own keystrokes).
function PillEditor({
    value,
    onChange,
    placeholder,
    insertApi,
}: {
    value: string
    onChange: (next: string) => void
    placeholder?: string
    insertApi?: React.MutableRefObject<{insert: (path: string) => void} | null>
}) {
    const ref = useRef<HTMLDivElement>(null)
    const lastSerialized = useRef<string>("")
    const [empty, setEmpty] = useState(!value.trim())

    const makePill = useCallback((selector: string) => {
        const inner = selector.startsWith("$.") ? selector.slice(2) : selector
        const span = document.createElement("span")
        span.dataset.token = inner
        span.contentEditable = "false"
        span.className =
            "mx-0.5 inline-flex select-none items-center rounded bg-[var(--ag-colorPrimaryBg)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--ag-colorPrimary)]"
        span.textContent = selectorLabel(selector)
        return span
    }, [])

    const render = useCallback(
        (tpl: string) => {
            const el = ref.current
            if (!el) return
            el.innerHTML = ""
            for (const seg of splitTemplate(tpl)) {
                if (seg.literal != null) {
                    seg.literal.split("\n").forEach((part, i) => {
                        if (i > 0) el.appendChild(document.createElement("br"))
                        if (part) el.appendChild(document.createTextNode(part))
                    })
                } else if (seg.selector != null) {
                    el.appendChild(makePill(seg.selector))
                }
            }
        },
        [makePill],
    )

    const serialize = useCallback((el: HTMLElement): string => {
        let out = ""
        el.childNodes.forEach((node) => {
            if (node.nodeType === Node.TEXT_NODE) out += node.textContent ?? ""
            else if (node instanceof HTMLElement) {
                if (node.dataset.token != null) out += `{{${node.dataset.token}}}`
                else if (node.tagName === "BR") out += "\n"
                else out += "\n" + serialize(node)
            }
        })
        return out
    }, [])

    useEffect(() => {
        if (value !== lastSerialized.current) {
            render(value)
            lastSerialized.current = value
            setEmpty(!value.trim())
        }
    }, [value, render])

    const commit = useCallback(() => {
        const el = ref.current
        if (!el) return
        const next = serialize(el)
        lastSerialized.current = next
        setEmpty(!next.trim())
        onChange(next)
    }, [serialize, onChange])

    useEffect(() => {
        if (!insertApi) return
        insertApi.current = {
            insert: (path: string) => {
                const el = ref.current
                if (!el) return
                el.focus()
                const sel = window.getSelection()
                const pill = makePill(`$.${path}`)
                const space = document.createTextNode(" ")
                let range: Range
                if (sel?.rangeCount && el.contains(sel.anchorNode)) {
                    range = sel.getRangeAt(0)
                    range.deleteContents()
                } else {
                    range = document.createRange()
                    range.selectNodeContents(el)
                    range.collapse(false)
                }
                range.insertNode(space)
                range.insertNode(pill)
                range.setStartAfter(space)
                range.collapse(true)
                sel?.removeAllRanges()
                sel?.addRange(range)
                commit()
            },
        }
    })

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key !== "Enter") return
        e.preventDefault()
        const sel = window.getSelection()
        if (!sel?.rangeCount) return
        const range = sel.getRangeAt(0)
        range.deleteContents()
        const br = document.createElement("br")
        range.insertNode(br)
        range.setStartAfter(br)
        range.collapse(true)
        sel.removeAllRanges()
        sel.addRange(range)
        commit()
    }

    return (
        <div className="relative">
            <div
                ref={ref}
                contentEditable
                suppressContentEditableWarning
                role="textbox"
                aria-multiline="true"
                onInput={commit}
                onKeyDown={onKeyDown}
                className="box-border max-h-[280px] min-h-[120px] w-full overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-solid border-[var(--ag-colorBorder)] bg-[var(--ag-colorBgContainer)] px-3 py-2 text-xs leading-relaxed outline-none focus:border-[var(--ag-colorPrimary)]"
            />
            {empty && placeholder && (
                <div className="pointer-events-none absolute left-3 top-2 text-xs text-[var(--ag-colorTextPlaceholder)]">
                    {placeholder}
                </div>
            )}
        </div>
    )
}

// ---------------------------------------------------------------------------
// Non-agent mapping: raw-JSON editor with live selector validation + path hints
// (restored committed behavior). Each leaf string is a selector resolved at delivery
// (`$...` JSONPath, `/...` JSON Pointer, else literal); we preview each against the sample.
// ---------------------------------------------------------------------------

interface MappingLeaf {
    key: string
    isSelector: boolean
    resolved?: string
}

function analyzeMapping(
    text: string,
    context: Record<string, unknown> | null,
): {leaves: MappingLeaf[]; parseError: string | null} {
    const trimmed = text.trim()
    if (!trimmed) return {leaves: [], parseError: null}
    let parsed: unknown
    try {
        parsed = JSON.parse(trimmed)
    } catch (e) {
        return {leaves: [], parseError: e instanceof Error ? e.message : "Invalid JSON"}
    }
    if (typeof parsed === "string") {
        const isSelector = parsed.startsWith("$") || parsed.startsWith("/")
        const resolved = isSelector && context ? resolveSelectorPreview(parsed, context) : undefined
        return {
            leaves: [
                {
                    key: "(whole context)",
                    isSelector,
                    resolved: resolved === undefined ? undefined : previewValue(resolved),
                },
            ],
            parseError: null,
        }
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return {leaves: [], parseError: "Mapping must be a JSON object or a selector string"}
    }
    const leaves: MappingLeaf[] = []
    for (const [key, rawValue] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof rawValue !== "string") {
            leaves.push({key, isSelector: false})
            continue
        }
        const isSelector = rawValue.startsWith("$") || rawValue.startsWith("/")
        if (!isSelector) {
            leaves.push({key, isSelector: false})
            continue
        }
        const resolved = context ? resolveSelectorPreview(rawValue, context) : undefined
        leaves.push({
            key,
            isSelector: true,
            resolved: resolved === undefined ? undefined : previewValue(resolved),
        })
    }
    return {leaves, parseError: null}
}

function InputsMappingField({
    value,
    onChange,
    error,
    onErrorChange,
    eventPayload,
}: {
    value: string
    onChange: (next: string) => void
    error: string | null
    onErrorChange: (next: string | null) => void
    eventPayload: Record<string, unknown> | null
}) {
    const context = useMemo(() => buildPreviewContext(eventPayload), [eventPayload])
    const {leaves, parseError} = useMemo(() => analyzeMapping(value, context), [value, context])
    useEffect(() => {
        onErrorChange(parseError)
    }, [parseError, onErrorChange])
    const payloadKeys = useMemo(
        () =>
            Object.keys(
                (context.event as {attributes?: Record<string, unknown>})?.attributes ?? {},
            ).map((k) => `event.attributes.${k}`),
        [context],
    )
    return (
        <Form.Item
            label="Inputs mapping"
            validateStatus={error ? "error" : undefined}
            help={error ?? "Maps event context to the workflow inputs (JSON)"}
        >
            <div className="overflow-hidden rounded-lg border border-solid border-[var(--ag-colorBorder)]">
                <Editor
                    initialValue={value || "{}"}
                    onChange={({textContent}) => onChange(textContent)}
                    codeOnly
                    showToolbar={false}
                    language="json"
                    dimensions={{width: "100%", height: 120}}
                />
            </div>
            <Typography.Text type="secondary" className="mt-1 block !text-[11px] leading-snug">
                String values are selectors against the event payload: <code>$.path</code>{" "}
                (JSONPath), <code>/path</code> (JSON Pointer), or a literal.
            </Typography.Text>
            {payloadKeys.length > 0 && (
                <div className="mt-1 flex flex-wrap items-center gap-1">
                    <Typography.Text type="secondary" className="!text-[11px]">
                        Available:
                    </Typography.Text>
                    {payloadKeys.slice(0, 12).map((k) => (
                        <code
                            key={k}
                            className="rounded bg-[var(--ag-colorFillSecondary)] px-1 text-[11px] text-[var(--ag-colorText)]"
                        >
                            $.{k}
                        </code>
                    ))}
                    {payloadKeys.length > 12 && (
                        <Typography.Text type="secondary" className="!text-[11px]">
                            +{payloadKeys.length - 12} more
                        </Typography.Text>
                    )}
                </div>
            )}
            {!parseError && leaves.length > 0 && (
                <div className="mt-1.5 flex flex-col gap-0.5">
                    {leaves.map((leaf, i) => (
                        <div
                            key={`${leaf.key}-${i}`}
                            className="flex items-center gap-1.5 text-[11px] leading-snug"
                        >
                            <code className="text-[var(--ag-colorTextSecondary)]">{leaf.key}</code>
                            <span className="text-[var(--ag-colorTextTertiary)]">→</span>
                            {leaf.isSelector ? (
                                leaf.resolved === undefined ? (
                                    <Typography.Text type="warning" className="!text-[11px]">
                                        no sample value
                                    </Typography.Text>
                                ) : (
                                    <code className="max-w-[280px] truncate text-[var(--ag-colorSuccess)]">
                                        {leaf.resolved}
                                    </code>
                                )
                            ) : (
                                <Typography.Text type="secondary" className="!text-[11px]">
                                    literal
                                </Typography.Text>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </Form.Item>
    )
}

function MappingSection({
    value,
    onChange,
    error,
    onErrorChange,
    eventSample,
    deliveryPreview,
    onSample,
    onWaitForEvent,
    recentEvents = [],
    isAgent,
    isChat,
    primaryKey,
}: {
    value: string
    onChange: (next: string) => void
    error: string | null
    onErrorChange: (next: string | null) => void
    /** RAW event (catalog schema / draft probe) — the field panel + preview source. */
    eventSample: Record<string, unknown> | null
    /** A saved trigger's last delivered (mapped) output — shown read-only, never a field source. */
    deliveryPreview?: Record<string, unknown> | null
    onSample: (event: SampledEvent) => void
    onWaitForEvent?: () => Promise<SampledEvent | null>
    recentEvents?: SampledEvent[]
    isAgent: boolean
    isChat: boolean
    primaryKey: string
}) {
    const samplePayload = eventSample
    const context = useMemo(() => buildPreviewContext(eventSample), [eventSample])
    const [raw, setRaw] = useState(false)
    const insertApi = useRef<{insert: (path: string) => void} | null>(null)

    // Token template is the composer's source of truth; it compiles to `value`
    // (inputs_fields JSON). Resync only when `value` changes from OUTSIDE (e.g. the
    // edit-mode prefill loads) — detected by comparing against our own compilation.
    const [template, setTemplate] = useState(() => parseMessageTemplate(value, isChat, primaryKey))

    useEffect(() => {
        const compiled = JSON.stringify(compileMessageTemplate(template, isChat, primaryKey))
        let current = value
        try {
            current = JSON.stringify(JSON.parse(value))
        } catch {
            /* keep raw */
        }
        if (compiled !== current) setTemplate(parseMessageTemplate(value, isChat, primaryKey))
    }, [value, isChat, primaryKey])

    // Surface raw-JSON parse errors (the composer always emits valid JSON).
    useEffect(() => {
        if (!value.trim()) {
            onErrorChange(null)
            return
        }
        try {
            JSON.parse(value)
            onErrorChange(null)
        } catch {
            onErrorChange("Invalid JSON")
        }
    }, [value, onErrorChange])

    const setTpl = useCallback(
        (next: string) => {
            setTemplate(next)
            onChange(JSON.stringify(compileMessageTemplate(next, isChat, primaryKey), null, 2))
        },
        [onChange, isChat, primaryKey],
    )

    const fieldRows = useMemo(() => {
        const attrs = (context.event as {attributes?: Record<string, unknown>})?.attributes ?? {}
        return Object.keys(attrs).map((k) => {
            const selector = `$.event.attributes.${k}`
            const resolved = resolveSelectorPreview(selector, context)
            return {
                key: k,
                label: selectorLabel(selector),
                value: resolved === undefined ? "—" : previewValue(resolved),
            }
        })
    }, [context])

    const preview = useMemo(
        () =>
            splitTemplate(template)
                .map((seg) => {
                    if (seg.literal != null) return seg.literal
                    const resolved = seg.selector
                        ? resolveSelectorPreview(seg.selector, context)
                        : undefined
                    return resolved === undefined ? "…" : previewValue(resolved)
                })
                .join(""),
        [template, context],
    )

    // Non-agent workflows keep the committed raw-JSON mapping editor (no token composer).
    if (!isAgent) {
        return (
            <div className="flex min-w-0 flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                    <Typography.Text type="secondary" className="!text-[11px] leading-snug">
                        Map the event into the workflow inputs (JSON).
                    </Typography.Text>
                    <EventSourcePicker
                        placement="bottomRight"
                        trigger={
                            <button
                                type="button"
                                className="flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[11px] font-medium text-[var(--ag-colorPrimary)] hover:opacity-80"
                            >
                                <Lightning size={12} weight="fill" /> Test event
                            </button>
                        }
                        recentEvents={recentEvents}
                        onPick={onSample}
                        onWaitForEvent={onWaitForEvent}
                        waitHint="trigger it from the app now"
                    />
                </div>
                <InputsMappingField
                    value={value}
                    onChange={onChange}
                    error={error}
                    onErrorChange={onErrorChange}
                    eventPayload={eventSample}
                />
            </div>
        )
    }

    return (
        <div className="flex min-w-0 flex-col gap-2">
            <Typography.Text type="secondary" className="!text-[11px] leading-snug">
                {isChat
                    ? "Write the message your agent receives. Click a field to drop in its live value."
                    : "Build the agent's input from the event. Click a field to drop in its live value."}
            </Typography.Text>

            {raw ? (
                <div className="overflow-hidden rounded-lg border border-solid border-[var(--ag-colorBorder)]">
                    <Editor
                        initialValue={value || "{}"}
                        onChange={({textContent}) => onChange(textContent)}
                        codeOnly
                        showToolbar={false}
                        language="json"
                        dimensions={{width: "100%", height: 140}}
                    />
                </div>
            ) : (
                <div className="flex min-w-0 gap-3">
                    {/* Left rail = the data (event fields + live values), like the other sections' rails. */}
                    <div className="flex w-[200px] shrink-0 flex-col gap-1">
                        <div className="flex items-center justify-between gap-2">
                            <Typography.Text
                                type="secondary"
                                className="!text-[11px] font-medium uppercase tracking-wide"
                            >
                                Event fields
                            </Typography.Text>
                            <EventSourcePicker
                                placement="bottomRight"
                                trigger={
                                    <button
                                        type="button"
                                        className="flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[11px] font-medium text-[var(--ag-colorPrimary)] hover:opacity-80"
                                    >
                                        <Lightning size={12} weight="fill" /> Test event
                                    </button>
                                }
                                recentEvents={recentEvents}
                                onPick={onSample}
                                onWaitForEvent={onWaitForEvent}
                                waitHint="trigger it from the app now"
                            />
                        </div>
                        <div className="flex max-h-[220px] flex-col gap-0.5 overflow-y-auto">
                            {fieldRows.length > 0 ? (
                                fieldRows.map((f) => (
                                    <Tooltip
                                        key={f.key}
                                        title={`${f.label}: ${f.value.slice(0, 300)}${
                                            f.value.length > 300 ? "…" : ""
                                        }`}
                                        placement="left"
                                        mouseEnterDelay={0.4}
                                    >
                                        <button
                                            type="button"
                                            onClick={() =>
                                                insertApi.current?.insert(
                                                    `event.attributes.${f.key}`,
                                                )
                                            }
                                            className="group flex w-full items-center gap-2 rounded-md border-0 bg-transparent px-2 py-1.5 text-left hover:bg-[var(--ag-colorFillSecondary)]"
                                        >
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate text-xs font-medium text-[var(--ag-colorText)]">
                                                    {f.label}
                                                </span>
                                                <span className="block truncate font-mono text-[11px] text-[var(--ag-colorTextSecondary)]">
                                                    {f.value}
                                                </span>
                                            </span>
                                            <Plus
                                                size={13}
                                                className="shrink-0 text-[var(--ag-colorTextTertiary)] opacity-0 group-hover:text-[var(--ag-colorPrimary)] group-hover:opacity-100"
                                            />
                                        </button>
                                    </Tooltip>
                                ))
                            ) : (
                                <div className="rounded-md border border-dashed border-[var(--ag-colorBorder)] px-2 py-3 text-center text-[11px] leading-snug text-[var(--ag-colorTextTertiary)]">
                                    Get a sample event to see its fields and values.
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Right = the message built from that data (divider mirrors the other sections). */}
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5 border-0 border-l border-solid border-[var(--ag-colorBorderSecondary)] pl-3">
                        <Typography.Text
                            type="secondary"
                            className="!text-[11px] font-medium uppercase tracking-wide"
                        >
                            Message
                        </Typography.Text>
                        <PillEditor
                            value={template}
                            onChange={setTpl}
                            insertApi={insertApi}
                            placeholder={
                                isChat
                                    ? "Type a message and click a field on the left to insert its value…"
                                    : "Build the agent's input — type text and click fields on the left…"
                            }
                        />
                        {samplePayload && template.trim() && (
                            <div className="rounded-md bg-[var(--ag-colorFillQuaternary)] px-2.5 py-1.5">
                                <div className="mb-0.5 text-[10px] uppercase tracking-wide text-[var(--ag-colorTextTertiary)]">
                                    {deliveryPreview ? "Agent would receive" : "Agent receives"}
                                </div>
                                <div className="max-h-[120px] overflow-y-auto whitespace-pre-wrap break-words text-[11px] text-[var(--ag-colorText)]">
                                    {preview}
                                </div>
                            </div>
                        )}
                        {deliveryPreview && (
                            <div className="rounded-md border border-solid border-[var(--ag-colorBorderSecondary)] px-2.5 py-1.5">
                                <div className="mb-0.5 text-[10px] uppercase tracking-wide text-[var(--ag-colorTextTertiary)]">
                                    Agent received · last real delivery
                                </div>
                                <div className="max-h-[120px] overflow-y-auto whitespace-pre-wrap break-words text-[11px] text-[var(--ag-colorText)]">
                                    {getScheduleMessagePreview(deliveryPreview) || "—"}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            <button
                type="button"
                onClick={() => setRaw((r) => !r)}
                className="cursor-pointer self-start border-0 bg-transparent p-0 text-[11px] text-[var(--ag-colorTextSecondary)] hover:text-[var(--ag-colorText)]"
            >
                {raw ? "← Back to composer" : "Advanced · raw JSON"}
            </button>

            {error && (
                <Typography.Text type="danger" className="!text-[11px]">
                    {error}
                </Typography.Text>
            )}
        </div>
    )
}

// ---------------------------------------------------------------------------
// RunSubscriptionButton — footer run-in-playground. A subscription has no static
// payload, so it sources a real event (EventSourcePicker: wait / recent) and runs
// the agent with it. Disabled until the subscription is saved.
// ---------------------------------------------------------------------------

function RunSubscriptionButton({
    playgroundEntityId,
    name,
    eventKey,
    disabled,
    onClose,
}: {
    playgroundEntityId: string
    name: string
    eventKey: string
    disabled?: boolean
    onClose: () => void
}) {
    const setPendingRun = useSetAtom(simulatedAgentRunAtomFamily(playgroundEntityId))

    const run = useCallback(
        (event: SampledEvent) => {
            const label = name || eventKey || "Trigger"
            const preview = getScheduleMessagePreview(event.payload)
            const text = preview
                ? preview
                : `[Trigger · ${label}]\n\`\`\`json\n${JSON.stringify(event.payload ?? {}, null, 2)}\n\`\`\``
            setPendingRun({text, nonce: Date.now(), newSession: true})
            onClose()
        },
        [name, eventKey, setPendingRun, onClose],
    )

    if (disabled) {
        return (
            <Tooltip title="Create the trigger first to run it">
                <span>
                    <Button icon={<Lightning size={14} />} disabled>
                        Run in playground
                    </Button>
                </span>
            </Tooltip>
        )
    }

    return (
        <EventSourcePicker
            placement="topRight"
            trigger={<Button icon={<Lightning size={14} />}>Run in playground</Button>}
            recentEvents={[]}
            onPick={run}
        />
    )
}

// Mirror of the backend dispatcher `_build_context`: the raw provider payload becomes
// `event.attributes`, alongside the synthetic event fields. Token selectors preview
// against this shape.
function buildPreviewContext(payload: Record<string, unknown> | null): Record<string, unknown> {
    return {
        event: {
            event_id: "evt_…",
            event_type: "…",
            timestamp: "…",
            created_at: "…",
            attributes: payload ?? {},
        },
    }
}

// The catalog ships the event `payload` as a JSON Schema (properties/required/type), not an
// instance. Detect that so we can derive an example from its `properties` instead of listing
// the schema's own meta-keys.
function isJsonSchema(payload: Record<string, unknown>): boolean {
    return (
        payload.type === "object" && !!payload.properties && typeof payload.properties === "object"
    )
}

// Build a representative instance from a JSON Schema node: real `example`/`examples`/`default`
// when present, else recurse objects/arrays, else a typed placeholder (e.g. "<string>").
function schemaToExample(node: unknown): unknown {
    if (!node || typeof node !== "object") return node
    const n = node as Record<string, unknown>
    if (n.example !== undefined) return n.example
    if (Array.isArray(n.examples) && n.examples.length) return n.examples[0]
    if (n.default !== undefined) return n.default
    if (n.properties && typeof n.properties === "object") {
        const out: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(n.properties as Record<string, unknown>)) {
            out[k] = schemaToExample(v)
        }
        return out
    }
    if (n.type === "array") return [schemaToExample(n.items ?? {})]
    const t = Array.isArray(n.type) ? n.type[0] : n.type
    return t ? `<${String(t)}>` : "<value>"
}

// Normalize a catalog payload (schema OR instance) into an example instance for the mapper.
function eventExampleFromPayload(
    payload: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
    if (!payload) return null
    if (isJsonSchema(payload)) return schemaToExample(payload) as Record<string, unknown>
    return payload
}
