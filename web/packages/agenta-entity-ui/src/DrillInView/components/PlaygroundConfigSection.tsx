/**
 * PlaygroundConfigSection
 *
 * Schema-driven configuration renderer for playground entities.
 * Uses workflowMolecule as the default data source.
 *
 * Data wiring:
 * - Reads from workflowMolecule (configuration, query, parametersSchema) by default
 * - Writes via workflowMolecule.actions.updateConfiguration by default
 * - Supports custom moleculeAdapter for specialized behavior
 * - Schema drives control selection via getSchemaAtPath
 * - Model config popover injected via fieldHeader slot
 *
 * Composition root only: the adapter, the pure helpers, the configure popover and
 * the drill-in field slots live in `./PlaygroundConfigSection/*`.
 */

import {memo, useMemo, useCallback, useEffect, useRef, useState} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import type {DataPath} from "@agenta/shared/utils"
import type {MoleculeDrillInAdapter} from "@agenta/ui/drill-in"
import {useDrillInUI} from "@agenta/ui/drill-in"
import {SharedEditor} from "@agenta/ui/shared-editor"
import clsx from "clsx"
import {useAtom, useAtomValue, useSetAtom} from "jotai"
import yaml from "js-yaml"

import {feedbackConfigModeAtomFamily} from "../SchemaControls/FeedbackConfigurationControl"
import {
    validateConfigAgainstSchema,
    type SchemaValidationError,
} from "../SchemaControls/schemaValidator"

import {MoleculeDrillInView} from "./MoleculeDrillInView"
import {defaultAdapter} from "./PlaygroundConfigSection/adapters"
import {SIBLING_GROUP_KEYS, type SiblingGroupKey} from "./PlaygroundConfigSection/constants"
import {
    collectAgentaMetadata,
    reattachAgentaMetadata,
    stripAgentaMetadata,
} from "./PlaygroundConfigSection/metadata"
import {
    hasRenderableConfigSections,
    isSiblingGroupKey,
    pickActiveData,
} from "./PlaygroundConfigSection/schemaData"
import type {ConfigViewMode, PlaygroundConfigSectionProps} from "./PlaygroundConfigSection/types"
import {useFieldSlots} from "./PlaygroundConfigSection/useFieldSlots"
import {useModelConfigurePopover} from "./PlaygroundConfigSection/useModelConfigurePopover"

export type {
    ConfigSectionMoleculeAdapter,
    ConfigViewMode,
    EvaluatorPresetConfig,
    PlaygroundConfigSectionProps,
} from "./PlaygroundConfigSection/types"

// Stable reference: a new object here would re-run the context's classNames memo every render.
const DRILL_IN_CLASS_NAMES = {fieldList: "bg-[var(--ag-surface-section-content)]"}

function PlaygroundConfigSection({
    revisionId: targetRevisionId,
    disabled = false,
    useServerData = false,
    className,
    moleculeAdapter,
    onRefinePrompt,
    viewMode: externalViewMode,
    stickyHeaderTop = 48,
    loadingFallback,
}: PlaygroundConfigSectionProps) {
    const {llmProviderConfig} = useDrillInUI()

    const mol = moleculeAdapter ?? defaultAdapter
    const dispatchUpdate = useSetAtom(mol.reducers.update)

    // ── Revision-switch latch (id, not data) ──
    // The playground keeps this component mounted and swaps `revisionId` in place (e.g. the
    // agent committing itself). Everything below — including the drill-in view, which resolves
    // data/schema BY ID — must stay on one consistent revision, so rendering the target id
    // before its data lands drops the drill-in to an empty state and remounts every section.
    // Keep rendering the PREVIOUS id until the target is renderable (or its query settles),
    // then swap in one commit so the sections update their values in place.
    const targetSchemaQuery = useAtomValue(
        useMemo(() => mol.atoms.schemaQuery(targetRevisionId), [mol, targetRevisionId]),
    )
    const targetActiveData = pickActiveData(
        useServerData,
        useAtomValue(useMemo(() => mol.atoms.data(targetRevisionId), [mol, targetRevisionId])),
        useAtomValue(
            useMemo(() => mol.atoms.serverData(targetRevisionId), [mol, targetRevisionId]),
        ),
    )
    const renderIdRef = useRef(targetRevisionId)
    if (
        renderIdRef.current !== targetRevisionId &&
        (hasRenderableConfigSections(targetActiveData) || !targetSchemaQuery.isPending)
    ) {
        renderIdRef.current = targetRevisionId
    }
    const revisionId = renderIdRef.current

    // Feedback config mode (shared with FeedbackConfigurationControl via atom)
    const feedbackModeAtom = useMemo(() => feedbackConfigModeAtomFamily(revisionId), [revisionId])
    const [feedbackMode, setFeedbackMode] = useAtom(feedbackModeAtom)

    // ========== DATA ==========
    const dataAtom = useMemo(() => mol.atoms.data(revisionId), [mol, revisionId])
    const data = useAtomValue(dataAtom)

    const serverDataAtom = useMemo(() => mol.atoms.serverData(revisionId), [mol, revisionId])
    const serverData = useAtomValue(serverDataAtom)

    // Schema query for loading state
    const schemaQuery = useAtomValue(
        useMemo(() => mol.atoms.schemaQuery(revisionId), [mol, revisionId]),
    )

    // Schema for model config popover
    const schemaAtom = useMemo(() => mol.atoms.agConfigSchema(revisionId), [mol, revisionId])
    const schema = useAtomValue(schemaAtom)

    // Choose the best available data for loading checks
    const activeData = pickActiveData(useServerData, data, serverData)

    const parameters = (activeData?.parameters ?? {}) as Record<string, unknown>

    // Sibling group (hook/code) surfaced as a section, if present.
    const siblingGroups = useMemo(() => {
        const out: Record<string, unknown> = {}
        const d = activeData as Record<string, unknown> | null
        if (d) {
            for (const group of SIBLING_GROUP_KEYS) {
                if (group in d) out[group] = d[group]
            }
        }
        return out
    }, [activeData])

    // A field is a sibling group only when it is actually present in siblingGroups
    // (built from data.uri). A legacy *parameter* named "code"/"hook" must NOT be
    // treated as the canonical code/hook group — it falls through to the schema renderer.
    const isPresentSiblingGroup = useCallback(
        (fieldKey: string): fieldKey is SiblingGroupKey =>
            isSiblingGroupKey(fieldKey) && fieldKey in siblingGroups,
        [siblingGroups],
    )

    const codeRuntime = (siblingGroups.code as Record<string, unknown> | undefined)?.runtime as
        | string
        | undefined
    const handleRuntimeChange = useCallback(
        (runtime: string) => {
            dispatchUpdate(revisionId, {__siblingData: {runtime}})
        },
        [dispatchUpdate, revisionId],
    )

    // ========== ADAPTER ==========
    // Build adapter with schema support, swapping data source for useServerData
    const drillInAdapter = useMemo(
        () =>
            ({
                atoms: {
                    data: useServerData ? mol.atoms.serverData : mol.atoms.data,
                    draft: mol.atoms.draft,
                    isDirty: mol.atoms.isDirty,
                },
                reducers: {
                    update: mol.reducers.update,
                    discard: mol.reducers.discard,
                },
                drillIn: {
                    ...mol.drillIn,
                    getSchemaAtPath: (path: DataPath) =>
                        mol.selectors.schemaAtPath({id: revisionId, path}),
                },
            }) as MoleculeDrillInAdapter<
                {parameters?: Record<string, unknown>},
                Record<string, unknown>
            >,
        [mol, revisionId, useServerData],
    )

    // ========== VIEW MODE (Form / JSON / YAML) ==========
    const [internalViewMode] = useState<ConfigViewMode>("form")
    const viewMode = externalViewMode ?? internalViewMode
    const [rawEditorValue, setRawEditorValue] = useState("")
    const [validationErrors, setValidationErrors] = useState<SchemaValidationError[]>([])

    // Write raw edits directly to the draft, bypassing evaluator flatten transform.
    const dispatchRawUpdate = useSetAtom(workflowMolecule.actions.update)

    // Track draft state so we can detect discard (draft goes from truthy → null)
    const draftAtom = useMemo(() => mol.atoms.draft(revisionId), [mol, revisionId])
    const draft = useAtomValue(draftAtom)

    // Strip agenta_metadata from tools before serializing for JSON/YAML view.
    // This metadata is internal and should not be exposed to the user.
    // Also collect metadata so it can be re-attached when the user saves edits.
    // Stabilize via serialized key to prevent infinite re-render loops when the
    // parameters object reference changes but content is identical (e.g., during
    // entity loading in URL-driven drawer initialization).
    const parametersKey = useMemo(() => JSON.stringify(parameters), [parameters])
    const {displayParameters, metadataMap} = useMemo(() => {
        return {
            displayParameters: stripAgentaMetadata(parameters),
            metadataMap: collectAgentaMetadata(parameters),
        }
    }, [parametersKey])

    // Derive a stable flag so the effect fires when draft is discarded (becomes null)
    const isDraftEmpty = draft === null || draft === undefined

    // Track DISCARD events to force re-mount of Form/YAML editors whose internal
    // state (Lexical editor, local control state) may not fully reset via prop
    // changes alone. Computed during render to avoid useEffect/setState loops.
    //
    // Revision-scoped on purpose: this component can now survive a revision SWITCH
    // (the agent playground's stable config host swaps `revisionId` in place), and a
    // switch from a drafted revision to a clean one flips `isDraftEmpty` false→true
    // exactly like a discard — bumping the version there remounted the whole form
    // (replaying the sections' entrance) for a plain switch. Only a draft emptying
    // on the SAME revision is a discard; a revision change just re-seeds the tracker.
    const discardVersionRef = useRef(0)
    const draftTrackerRef = useRef({revisionId, isDraftEmpty})
    if (
        draftTrackerRef.current.revisionId === revisionId &&
        isDraftEmpty &&
        !draftTrackerRef.current.isDraftEmpty
    ) {
        discardVersionRef.current += 1
    }
    draftTrackerRef.current = {revisionId, isDraftEmpty}

    // Eagerly sync rawEditorValue during render when entering a raw mode.
    // Without this, switching Form → YAML/JSON after a revision change renders
    // the SharedEditor with stale/empty content for one frame until the useEffect
    // fires. The code editor may not properly re-hydrate from that empty initial state.
    const prevViewModeRef = useRef(viewMode)
    if (viewMode !== "form" && prevViewModeRef.current !== viewMode) {
        const next =
            viewMode === "yaml"
                ? (() => {
                      try {
                          return yaml.dump(displayParameters, {indent: 2, lineWidth: -1})
                      } catch {
                          return JSON.stringify(displayParameters, null, 2)
                      }
                  })()
                : JSON.stringify(displayParameters, null, 2)
        // Only update if the content is actually different to avoid unnecessary re-renders
        if (next !== rawEditorValue) {
            setRawEditorValue(next)
        }
    }
    prevViewModeRef.current = viewMode

    // Track whether the latest displayParameters change was caused by the user
    // editing in this raw editor. When true, the sync effect skips re-serializing
    // to avoid overwriting the editor content (which kills focus/cursor).
    const isLocalEditRef = useRef(false)

    // Keep editor value in sync when parameters change from an external source
    // (e.g., form edits in another mode, draft discard, revision switch) while
    // already in a raw mode. Skips when the change originated from the user's
    // own typing in this editor to avoid a re-serialize → focus-loss loop.
    useEffect(() => {
        if (isLocalEditRef.current) {
            isLocalEditRef.current = false
            return
        }
        if (viewMode === "json") {
            setRawEditorValue(JSON.stringify(displayParameters, null, 2))
        } else if (viewMode === "yaml") {
            try {
                setRawEditorValue(yaml.dump(displayParameters, {indent: 2, lineWidth: -1}))
            } catch {
                setRawEditorValue(JSON.stringify(displayParameters, null, 2))
            }
        }
        setValidationErrors([])
    }, [viewMode, isDraftEmpty, displayParameters])

    const handleRawEditorChange = useCallback(
        (newValue: string) => {
            setRawEditorValue(newValue)
            try {
                const parsed =
                    viewMode === "yaml"
                        ? (yaml.load(newValue) as Record<string, unknown>)
                        : JSON.parse(newValue)
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                    // Re-attach agenta_metadata that was stripped for display
                    const withMetadata = reattachAgentaMetadata(parsed, metadataMap) as Record<
                        string,
                        unknown
                    >
                    // Mark that the next displayParameters change is from our own edit
                    isLocalEditRef.current = true
                    dispatchRawUpdate(revisionId, {data: {parameters: withMetadata}})

                    // Validate against parameters schema
                    const result = validateConfigAgainstSchema(
                        parsed as Record<string, unknown>,
                        schema as Record<string, unknown> | null,
                    )
                    setValidationErrors(result.errors)
                }
            } catch {
                // Invalid syntax — don't emit
            }
        },
        [dispatchRawUpdate, revisionId, viewMode, schema, metadataMap],
    )

    // ========== COLLAPSE STATE ==========
    const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
        advanced_settings: true,
        // Section open; individual schema cards default closed (SchemaEditor).
        schemas: false,
    })

    const toggleSection = useCallback((key: string) => {
        setCollapsedSections((prev) => ({...prev, [key]: !prev[key]}))
    }, [])

    // ========== COMBINED MODEL / FALLBACK / RETRY CONFIG POPOVER ==========
    const {configurePopoverContent, handleConfigureOpenChange, isModelConfigOpen, promptModelInfo} =
        useModelConfigurePopover({
            activeData,
            disabled,
            dispatchUpdate,
            llmProviderConfig,
            parameters,
            revisionId,
            schema,
            serverData,
        })

    // ========== DRILL-IN FIELD SLOTS ==========
    const drillInSlots = useFieldSlots({
        activeData,
        codeRuntime,
        collapsedSections,
        configurePopoverContent,
        disabled,
        feedbackMode,
        handleConfigureOpenChange,
        handleRuntimeChange,
        isModelConfigOpen,
        isPresentSiblingGroup,
        onRefinePrompt,
        parameters,
        promptModelInfo,
        schema,
        setFeedbackMode,
        siblingGroups,
        stickyHeaderTop,
        toggleSection,
    })

    // ========== LOADING / EMPTY STATE ==========
    const isConfigLoading = schemaQuery.isPending && !hasRenderableConfigSections(activeData)

    if (isConfigLoading) {
        if (loadingFallback) {
            // px-4 pb-3 pt-1 mirrors the agent_config field-content wrapper the real sections (and
            // the lazy control's Suspense fallback) render inside — without it the fallback skeleton
            // shifts when the schema lands.
            return <div className={clsx("px-4 pb-3 pt-1", className)}>{loadingFallback}</div>
        }
        return (
            <div className={clsx("p-4 flex flex-col gap-3", className)}>
                <div className="h-9 rounded bg-[var(--ag-rgba-051729-06)] animate-pulse" />
                <div className="h-32 rounded border border-solid border-[var(--ag-rgba-051729-08)] bg-[var(--ag-rgba-051729-02)] animate-pulse" />
                <div className="h-24 rounded border border-solid border-[var(--ag-rgba-051729-08)] bg-[var(--ag-rgba-051729-02)] animate-pulse" />
            </div>
        )
    }

    if (!hasRenderableConfigSections(activeData)) {
        return (
            <div
                className={clsx("flex flex-col items-center justify-center py-12 px-6", className)}
            >
                <div className="flex flex-col items-center gap-2 text-center max-w-[320px]">
                    <span className="text-sm font-medium text-[var(--ag-rgba-051729-65)]">
                        No configuration needed
                    </span>
                    <span className="text-xs text-[var(--ag-rgba-051729-45)]">
                        This evaluator runs with default settings. You can use it directly without
                        any additional configuration.
                    </span>
                </div>
            </div>
        )
    }

    // ========== RENDER ==========
    const hasTopLevelObjectSection = Object.values(parameters).some(
        (value) => value !== null && typeof value === "object" && !Array.isArray(value),
    )

    return (
        <div className={clsx("flex flex-col", className)}>
            {viewMode !== "form" ? (
                <div className="px-3 pb-3">
                    <div
                        className={clsx(
                            "border border-solid rounded overflow-hidden",
                            validationErrors.length > 0
                                ? "border-[var(--ag-c-FF4D4F)]"
                                : "border-gray-200",
                        )}
                    >
                        <SharedEditor
                            key={`${viewMode}-${discardVersionRef.current}`}
                            editorType="border"
                            placeholder={`Enter ${viewMode.toUpperCase()} configuration…`}
                            initialValue={rawEditorValue}
                            value={rawEditorValue}
                            handleChange={handleRawEditorChange}
                            disabled={disabled || useServerData}
                            editorProps={{
                                codeOnly: true,
                                language: viewMode === "yaml" ? "yaml" : "json",
                            }}
                            syncWithInitialValueChanges={true}
                        />
                    </div>
                    {validationErrors.length > 0 && (
                        <div className="mt-1.5 flex flex-col gap-0.5">
                            {validationErrors.map((err, i) => (
                                <div
                                    key={`${err.path}-${i}`}
                                    className="text-xs text-[var(--ag-c-FF4D4F)] leading-tight"
                                >
                                    <span className="font-mono font-medium">{err.path}</span>
                                    {": "}
                                    {err.message}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            ) : (
                <>
                    {!hasTopLevelObjectSection && (
                        <div
                            className="flex items-center w-full px-3 py-2 bg-[var(--ag-surface-section-header)] border-0 border-b border-solid border-colorBorderSecondary sticky z-[2]"
                            style={{top: stickyHeaderTop}}
                        >
                            <span className="capitalize font-medium text-sm">Config</span>
                        </div>
                    )}
                    <MoleculeDrillInView
                        key={`form-${discardVersionRef.current}`}
                        entityId={revisionId}
                        molecule={drillInAdapter}
                        editable={!disabled && !useServerData}
                        rootTitle="Configuration"
                        showBreadcrumb={false}
                        collapsible={false}
                        slots={drillInSlots}
                        // Section content is a white sheet on the warm panel body. Scoped to
                        // this mount so other drill-in surfaces (drawers, modals) are untouched.
                        classNames={DRILL_IN_CLASS_NAMES}
                    />
                </>
            )}
        </div>
    )
}

export default memo(PlaygroundConfigSection)
