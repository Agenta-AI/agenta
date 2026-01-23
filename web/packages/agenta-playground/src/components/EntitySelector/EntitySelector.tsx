/**
 * Entity Selector Modal
 *
 * Configurable modal for selecting playground entities.
 * Uses EntityPicker from @agenta/entities/ui for hierarchical selection.
 *
 * Cascade levels:
 * - App Revision: App -> Variant -> Revision (via EntityPicker)
 * - Evaluator Revision: Evaluator -> Variant -> Revision (via EntityPicker)
 * - Testcase: ID input (testset integration coming)
 * - Span: ID input
 *
 * ## Controller Pattern
 *
 * Modal state is managed via entitySelectorController for consistency
 * with other playground controllers (playgroundController, outputConnectionController).
 *
 * ```typescript
 * import { useEntitySelector } from '@agenta/playground/entity-selector'
 *
 * const { open } = useEntitySelector()
 * const selection = await open({ allowedTypes: ['appRevision', 'evaluatorRevision'] })
 * ```
 */

import {
    useState,
    useMemo,
    useCallback,
    useEffect,
    createContext,
    useContext,
    useRef,
    type ReactNode,
} from "react"

import type {VariantListItem, RevisionListItem} from "@agenta/entities/appRevision"
import type {EntitySelectorConfig, EntitySelection, EntityType} from "@agenta/entities/runnable"
import {EntityPicker, type EvaluatorRevisionSelectionResult} from "@agenta/entities/ui"
import {EnhancedModal, EntityNameWithVersion} from "@agenta/ui"
import {CaretRight} from "@phosphor-icons/react"
import {Input, Button, Tabs, Space, Typography, Select} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {entitySelectorController, cascadingSelection} from "../../state"

const {Text} = Typography

/** Custom option type for revision select with searchLabel */
interface RevisionSelectOption {
    value: string
    label: ReactNode
    searchLabel: string
}

// Re-export types from controller for convenience
export type {EntityType, EntitySelection, EntitySelectorConfig}

interface EntitySelectorContextType {
    open: (config?: EntitySelectorConfig) => Promise<EntitySelection | null>
    close: () => void
}

// ============================================================================
// APP REVISION SELECTOR (Cascading Selects: App -> Variant -> Revision)
// Uses cascadingSelection atoms for auto-selection logic in data layer
// ============================================================================

function AppRevisionSelector({onSelect}: {onSelect: (selection: EntitySelection) => void}) {
    // Read from cascading selection atoms (derived state)
    const userSelectedAppId = useAtomValue(cascadingSelection.atoms.userSelectedAppId)
    const apps = useAtomValue(cascadingSelection.selectors.apps)
    const variants = useAtomValue(cascadingSelection.selectors.variantsForSelectedApp)
    const revisions = useAtomValue(cascadingSelection.selectors.revisionsForEffectiveVariant)
    const effectiveVariantId = useAtomValue(cascadingSelection.selectors.effectiveVariantId)
    const selectedApp = useAtomValue(cascadingSelection.selectors.selectedApp)
    const selectedVariant = useAtomValue(cascadingSelection.selectors.selectedVariant)
    const autoCompletedSelection = useAtomValue(cascadingSelection.selectors.autoCompletedSelection)

    // Query states for loading indicators
    const appsQueryState = useAtomValue(cascadingSelection.queryState.apps)
    const variantsQueryState = useAtomValue(cascadingSelection.queryState.variants)
    const revisionsQueryState = useAtomValue(cascadingSelection.queryState.revisions)

    // Actions
    const setAppId = useSetAtom(cascadingSelection.actions.setAppId)
    const setVariantId = useSetAtom(cascadingSelection.atoms.userSelectedVariantId)
    const resetSelection = useSetAtom(cascadingSelection.actions.reset)

    // Reset selection when component unmounts (modal closes)
    useEffect(() => {
        return () => {
            resetSelection()
        }
    }, [resetSelection])

    // Trigger selection when auto-complete is ready (from atom layer)
    useEffect(() => {
        if (autoCompletedSelection) {
            onSelect(autoCompletedSelection)
        }
    }, [autoCompletedSelection, onSelect])

    const handleAppChange = useCallback(
        (appId: string) => {
            setAppId(appId)
        },
        [setAppId],
    )

    const handleVariantChange = useCallback(
        (variantId: string) => {
            setVariantId(variantId)
        },
        [setVariantId],
    )

    const handleRevisionSelect = useCallback(
        (revisionId: string) => {
            const revision = revisions.find((r) => r.id === revisionId)
            if (!revision || !selectedApp || !selectedVariant) return

            onSelect({
                type: "appRevision",
                id: revisionId,
                label: `${selectedApp.name} / ${selectedVariant.name} / v${revision.version}`,
                metadata: {
                    appId: selectedApp.id,
                    appName: selectedApp.name,
                    variantId: selectedVariant.id,
                    variantName: selectedVariant.name,
                },
            })
        },
        [revisions, selectedApp, selectedVariant, onSelect],
    )

    // Derive loading/error messages for better UX
    const getAppsNotFoundContent = () => {
        if (appsQueryState.isPending) return "Loading applications..."
        if (appsQueryState.isError) return "Failed to load applications"
        if (apps.length === 0) return "No applications found"
        return "No match"
    }

    const getVariantsNotFoundContent = () => {
        if (!userSelectedAppId) return "Select an app first"
        if (variantsQueryState.isPending) return "Loading variants..."
        if (variantsQueryState.isError) return "Failed to load variants"
        if (variants.length === 0) return "No variants found"
        return "No match"
    }

    const getRevisionsNotFoundContent = () => {
        if (!effectiveVariantId) return "Select a variant first"
        if (revisionsQueryState.isPending) return "Loading revisions..."
        if (revisionsQueryState.isError) return "Failed to load revisions"
        if (revisions.length === 0) return "No revisions found"
        return "No match"
    }

    return (
        <div className="flex flex-col gap-3">
            {/* App Select */}
            <div>
                <Text type="secondary" className="text-xs mb-1 block">
                    Application
                </Text>
                <Select
                    className="w-full"
                    placeholder={
                        appsQueryState.isPending ? "Loading..." : "Select an application..."
                    }
                    value={userSelectedAppId}
                    onChange={handleAppChange}
                    loading={appsQueryState.isPending}
                    disabled={appsQueryState.isPending}
                    status={appsQueryState.isError ? "error" : undefined}
                    options={apps.map((app) => ({
                        value: app.id,
                        label: app.name,
                    }))}
                    showSearch
                    filterOption={(input, option) =>
                        (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
                    }
                    notFoundContent={getAppsNotFoundContent()}
                />
            </div>

            {/* Variant Select */}
            <div>
                <Text type="secondary" className="text-xs mb-1 block">
                    Variant
                </Text>
                <Select
                    className="w-full"
                    placeholder={
                        variantsQueryState.isPending
                            ? "Loading..."
                            : userSelectedAppId
                              ? "Select a variant..."
                              : "Select an app first"
                    }
                    value={effectiveVariantId}
                    onChange={handleVariantChange}
                    loading={variantsQueryState.isPending}
                    disabled={!userSelectedAppId || variantsQueryState.isPending}
                    status={variantsQueryState.isError ? "error" : undefined}
                    options={
                        userSelectedAppId
                            ? (variants as VariantListItem[]).map((variant) => ({
                                  value: variant.id,
                                  label: variant.name,
                              }))
                            : []
                    }
                    showSearch
                    filterOption={(input, option) =>
                        (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
                    }
                    notFoundContent={getVariantsNotFoundContent()}
                />
            </div>

            {/* Revision Select */}
            <div>
                <Text type="secondary" className="text-xs mb-1 block">
                    Revision
                </Text>
                <Select
                    className="w-full"
                    placeholder={
                        revisionsQueryState.isPending
                            ? "Loading..."
                            : effectiveVariantId
                              ? "Select a revision..."
                              : "Select a variant first"
                    }
                    loading={revisionsQueryState.isPending}
                    disabled={!effectiveVariantId || revisionsQueryState.isPending}
                    status={revisionsQueryState.isError ? "error" : undefined}
                    onChange={handleRevisionSelect}
                    options={
                        effectiveVariantId && selectedVariant
                            ? (revisions as RevisionListItem[]).map((revision) => ({
                                  value: revision.id,
                                  searchLabel: `${selectedVariant.name} v${revision.version}`,
                                  label: (
                                      <EntityNameWithVersion
                                          name={selectedVariant.name}
                                          version={revision.version}
                                          size="small"
                                      />
                                  ),
                              }))
                            : []
                    }
                    showSearch
                    filterOption={(input, option) =>
                        (option as RevisionSelectOption | undefined)?.searchLabel
                            ?.toLowerCase()
                            .includes(input.toLowerCase()) ?? false
                    }
                    notFoundContent={getRevisionsNotFoundContent()}
                />
            </div>
        </div>
    )
}

// ============================================================================
// EVALUATOR REVISION SELECTOR (Evaluator -> Variant -> Revision)
// ============================================================================

function EvaluatorRevisionSelector({onSelect}: {onSelect: (selection: EntitySelection) => void}) {
    const handleSelect = useCallback(
        (selection: EvaluatorRevisionSelectionResult) => {
            onSelect({
                type: "evaluatorRevision",
                id: selection.id,
                label: selection.label,
                metadata: {
                    evaluatorId: selection.metadata.evaluatorId,
                    evaluatorName: selection.metadata.evaluatorName,
                    evaluatorVariantId: selection.metadata.variantId,
                    evaluatorVariantName: selection.metadata.variantName,
                },
            })
        },
        [onSelect],
    )

    return (
        <EntityPicker<EvaluatorRevisionSelectionResult>
            adapter="evaluatorRevision"
            onSelect={handleSelect}
            autoSelectSingle
            showSearch
            showBreadcrumb
            showBackButton
            rootLabel="All Evaluators"
            emptyMessage="No evaluators available"
            loadingMessage="Loading evaluators..."
            maxHeight={300}
            instanceId="entity-selector-evaluator-revision"
        />
    )
}

// ============================================================================
// TESTCASE SELECTOR
// ============================================================================

function TestcaseSelector({onSelect}: {onSelect: (selection: EntitySelection) => void}) {
    const [testcaseId, setTestcaseId] = useState("")

    const handleSubmit = () => {
        if (testcaseId.trim()) {
            onSelect({
                type: "testcase",
                id: testcaseId.trim(),
                label: `Testcase ${testcaseId.slice(0, 8)}...`,
            })
        }
    }

    return (
        <Space direction="vertical" size="small" className="w-full">
            <Text type="secondary">Testcase ID</Text>
            <Space.Compact className="w-full">
                <Input
                    value={testcaseId}
                    onChange={(e) => setTestcaseId(e.target.value)}
                    placeholder="Enter testcase ID..."
                    onPressEnter={handleSubmit}
                />
                <Button
                    type="primary"
                    onClick={handleSubmit}
                    disabled={!testcaseId.trim()}
                    icon={<CaretRight size={16} />}
                >
                    Select
                </Button>
            </Space.Compact>
            <Text type="secondary">Testcase selection from testset coming soon</Text>
        </Space>
    )
}

// ============================================================================
// SPAN SELECTOR
// ============================================================================

function SpanSelector({onSelect}: {onSelect: (selection: EntitySelection) => void}) {
    const [spanId, setSpanId] = useState("")

    const handleSubmit = () => {
        if (spanId.trim()) {
            onSelect({
                type: "span",
                id: spanId.trim(),
                label: `Span ${spanId.slice(0, 8)}...`,
            })
        }
    }

    return (
        <Space direction="vertical" size="small" className="w-full">
            <Text type="secondary">Span ID</Text>
            <Space.Compact className="w-full">
                <Input
                    value={spanId}
                    onChange={(e) => setSpanId(e.target.value)}
                    placeholder="Enter span ID..."
                    onPressEnter={handleSubmit}
                />
                <Button
                    type="primary"
                    onClick={handleSubmit}
                    disabled={!spanId.trim()}
                    icon={<CaretRight size={16} />}
                >
                    Select
                </Button>
            </Space.Compact>
        </Space>
    )
}

// ============================================================================
// MODAL CONTENT
// ============================================================================

const ALL_ENTITY_TYPES: EntityType[] = ["appRevision", "evaluatorRevision", "testcase", "span"]

const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
    appRevision: "App Revision",
    evaluatorRevision: "Evaluator Revision",
    testcase: "Testcase",
    span: "Span",
}

function EntitySelectorContent({
    config,
    onSelect,
}: {
    config: EntitySelectorConfig
    onSelect: (selection: EntitySelection) => void
}) {
    const allowedTypes = config.allowedTypes ?? ALL_ENTITY_TYPES
    const [entityType, setEntityType] = useState<EntityType>(
        config.defaultType ?? allowedTypes[0] ?? "appRevision",
    )

    const tabItems = allowedTypes.map((type) => ({
        key: type,
        label: ENTITY_TYPE_LABELS[type],
        children: (
            <div className="pt-2 min-h-[200px]">
                {type === "appRevision" && <AppRevisionSelector onSelect={onSelect} />}
                {type === "evaluatorRevision" && <EvaluatorRevisionSelector onSelect={onSelect} />}
                {type === "testcase" && <TestcaseSelector onSelect={onSelect} />}
                {type === "span" && <SpanSelector onSelect={onSelect} />}
            </div>
        ),
    }))

    // If only one type, don't show tabs
    if (allowedTypes.length === 1) {
        return tabItems[0]?.children ?? null
    }

    return (
        <Tabs
            activeKey={entityType}
            onChange={(key) => setEntityType(key as EntityType)}
            items={tabItems}
        />
    )
}

// ============================================================================
// MODAL COMPONENT
// ============================================================================

interface EntitySelectorModalProps {
    onSelection: (selection: EntitySelection | null) => void
}

export function EntitySelectorModal({onSelection}: EntitySelectorModalProps) {
    // Use controller selectors (function-based pattern - requires useMemo)
    const isOpen = useAtomValue(useMemo(() => entitySelectorController.selectors.isOpen(), []))
    const config = useAtomValue(useMemo(() => entitySelectorController.selectors.config(), []))

    const handleSelect = useCallback(
        (selection: EntitySelection) => {
            onSelection(selection)
        },
        [onSelection],
    )

    const handleCancel = useCallback(() => {
        onSelection(null)
    }, [onSelection])

    return (
        <EnhancedModal
            open={isOpen}
            title={config.title ?? "Select Entity"}
            onCancel={handleCancel}
            footer={null}
            width={480}
        >
            <EntitySelectorContent config={config} onSelect={handleSelect} />
        </EnhancedModal>
    )
}

// ============================================================================
// CONTEXT & HOOK
// ============================================================================

const EntitySelectorContext = createContext<EntitySelectorContextType | null>(null)

export function EntitySelectorProvider({children}: {children: ReactNode}) {
    // Use ref to store resolver - avoids module-level mutable state and race conditions
    const pendingResolverRef = useRef<((selection: EntitySelection | null) => void) | null>(null)

    // Use controller actions - but don't use the return value for Promises
    // (Jotai's useSetAtom doesn't properly forward Promise return values)
    const setModalOpen = useSetAtom(useMemo(() => entitySelectorController.selectors.isOpen(), []))
    const setConfig = useSetAtom(useMemo(() => entitySelectorController.selectors.config(), []))

    const open = useCallback(
        (config: EntitySelectorConfig = {}): Promise<EntitySelection | null> => {
            // If there's a pending resolver, reject it before opening a new one
            if (pendingResolverRef.current) {
                pendingResolverRef.current(null)
            }

            return new Promise<EntitySelection | null>((resolve) => {
                pendingResolverRef.current = resolve
                setConfig(config)
                setModalOpen(true)
            })
        },
        [setConfig, setModalOpen],
    )

    const close = useCallback(() => {
        if (pendingResolverRef.current) {
            pendingResolverRef.current(null)
            pendingResolverRef.current = null
        }
        setModalOpen(false)
        setConfig({})
    }, [setConfig, setModalOpen])

    const handleSelection = useCallback(
        (selection: EntitySelection | null) => {
            if (pendingResolverRef.current) {
                pendingResolverRef.current(selection)
                pendingResolverRef.current = null
            }
            setModalOpen(false)
            setConfig({})
        },
        [setModalOpen, setConfig],
    )

    return (
        <EntitySelectorContext.Provider value={{open, close}}>
            {children}
            <EntitySelectorModal onSelection={handleSelection} />
        </EntitySelectorContext.Provider>
    )
}

/**
 * Hook to programmatically open the entity selector modal
 *
 * @example
 * ```tsx
 * const {open} = useEntitySelector()
 *
 * const handleConnect = async () => {
 *     const selection = await open({
 *         title: "Connect Input",
 *         allowedTypes: ["appRevision", "testcase"],
 *     })
 *     if (selection) {
 *         // Use the selection
 *     }
 * }
 * ```
 */
export function useEntitySelector() {
    const context = useContext(EntitySelectorContext)
    if (!context) {
        throw new Error("useEntitySelector must be used within EntitySelectorProvider")
    }
    return context
}

// ============================================================================
// STANDALONE SELECTOR (for inline usage)
// ============================================================================

interface EntitySelectorProps {
    onSelect: (selection: EntitySelection | null) => void
    config?: Omit<EntitySelectorConfig, "onSelect" | "onCancel">
}

export function EntitySelector({onSelect, config = {}}: EntitySelectorProps) {
    const handleSelect = useCallback(
        (selection: EntitySelection) => {
            onSelect(selection)
        },
        [onSelect],
    )

    return <EntitySelectorContent config={config} onSelect={handleSelect} />
}
