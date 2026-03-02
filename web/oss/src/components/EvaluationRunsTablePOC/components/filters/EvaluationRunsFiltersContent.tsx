import {useCallback, useEffect, useMemo} from "react"
import type {CSSProperties, MouseEvent as ReactMouseEvent, ReactNode} from "react"

import {Button, Divider, Select, Tag, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import type {RunFlagsFilter} from "@/oss/lib/hooks/usePreviewEvaluations"
import {testsetsListQueryAtomFamily} from "@/oss/state/entities/testset"

import {evaluationRunsTableComponentSliceAtom} from "../../atoms/context"
import {
    evaluationRunsResetFiltersAtom,
    evaluationRunsSearchInputAtom,
    evaluationRunsStatusFiltersAtom,
    evaluationRunsFiltersContextAtom,
    evaluationRunsFiltersSummaryAtom,
    evaluationRunsFilterOptionsAtom,
    evaluationRunsVariantOptionsAtom,
    evaluationRunsQueryOptionsAtom,
    evaluationRunsMetaUpdaterAtom,
    evaluationRunsFiltersDraftAtom,
    evaluationRunsFiltersDraftInitializeAtom,
    evaluationRunsFiltersDraftClearAtom,
} from "../../atoms/view"
import {EVALUATION_KIND_FILTER_OPTIONS, STATUS_OPTIONS} from "../../constants"
import type {ConcreteEvaluationRunKind} from "../../types"
import {buildTestsetOptions} from "../../utils/testsetOptions"

import QueryFilterOption from "./QueryFilterOption"
import QuickDateRangePicker from "./QuickDateRangePicker"

interface TagRenderProps {
    label: ReactNode
    value: string
    closable?: boolean
    onClose?: (event: ReactMouseEvent<HTMLElement>) => void
    className?: string
    style?: CSSProperties
}

const REFERENCE_FILTER_KEYS = ["testset", "evaluator", "app", "variant", "query"] as const

type ReferenceFilterKey = (typeof REFERENCE_FILTER_KEYS)[number]

type DraftReferenceFilters = Record<ReferenceFilterKey, string[]>

const EVALUATION_TYPE_VALUES = EVALUATION_KIND_FILTER_OPTIONS.map((option) => option.value)

const normalizeStatusFilters = (values: string[]) =>
    values
        .map((value) => String(value).trim().toLowerCase())
        .filter(Boolean)
        .sort()

const normalizeEvaluationTypes = (
    values: (string | ConcreteEvaluationRunKind)[],
): ConcreteEvaluationRunKind[] => {
    const set = new Set<ConcreteEvaluationRunKind>()
    values.forEach((value) => {
        const normalized = String(value).trim().toLowerCase()
        if (EVALUATION_TYPE_VALUES.includes(normalized as ConcreteEvaluationRunKind)) {
            set.add(normalized as ConcreteEvaluationRunKind)
        }
    })
    return EVALUATION_TYPE_VALUES.filter((value) => set.has(value))
}

const normalizeDateRange = (
    range: {from?: string | null; to?: string | null} | null,
): {from?: string | null; to?: string | null} | null => {
    if (!range) return null
    const from = range.from ?? null
    const to = range.to ?? null
    if (!from && !to) return null
    if (from && to && new Date(from).getTime() > new Date(to).getTime()) {
        return {from: to, to: from}
    }
    return {from, to}
}

const normalizeReferenceFilters = (values: DraftReferenceFilters) => {
    const next: Record<string, string[]> = {}
    REFERENCE_FILTER_KEYS.forEach((key) => {
        const normalized = values[key].map((value) => value.trim()).filter(Boolean)
        if (normalized.length) {
            next[key] = normalized
        }
    })
    return Object.keys(next).length ? next : null
}

const createSummarySignature = (summary: {
    statusFilters: string[]
    evaluatorFilters: string[]
    appFilters: string[]
    variantFilters: string[]
    queryFilters: string[]
    testsetFilters: string[]
    evaluationTypeFilters: ConcreteEvaluationRunKind[]
    dateRange: {from?: string | null; to?: string | null} | null
    mergedFlags: RunFlagsFilter
}) => {
    const sortStrings = (list: string[]) => [...list].sort()
    const sortedFlags = Object.entries(summary.mergedFlags ?? {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}:${value}`)

    return JSON.stringify({
        status: normalizeStatusFilters(summary.statusFilters),
        evaluator: sortStrings(summary.evaluatorFilters),
        app: sortStrings(summary.appFilters),
        variant: sortStrings(summary.variantFilters),
        query: sortStrings(summary.queryFilters),
        testset: sortStrings(summary.testsetFilters),
        flags: sortedFlags,
        evaluationTypes: normalizeEvaluationTypes(summary.evaluationTypeFilters),
        dateRange: normalizeDateRange(summary.dateRange),
    })
}

const createReferenceDraftFromSummary = (summary: {
    evaluatorFilters: string[]
    appFilters: string[]
    variantFilters: string[]
    queryFilters: string[]
    testsetFilters: string[]
}): DraftReferenceFilters => ({
    testset: summary.testsetFilters,
    evaluator: summary.evaluatorFilters,
    app: summary.appFilters,
    variant: summary.variantFilters,
    query: summary.queryFilters,
})

interface EvaluationRunsFiltersContentProps {
    isOpen: boolean
    onClose: () => void
}

const sectionClass = "flex flex-col gap-2"
const chipSelectClassName = "filter-chip-select"

const SectionTitle = ({children}: {children: React.ReactNode}) => (
    <Typography.Text strong className="text-gray-700">
        {children}
    </Typography.Text>
)

const Section = ({title, children}: {title: React.ReactNode; children: React.ReactNode}) => (
    <div className={sectionClass}>
        <SectionTitle>{title}</SectionTitle>
        {children}
    </div>
)

const FieldGrid = ({children}: {children: ReactNode}) => (
    <div className="grid grid-cols-2 gap-3 w-full">{children}</div>
)

const EvaluationRunsFiltersContent = ({isOpen, onClose}: EvaluationRunsFiltersContentProps) => {
    const persistedStatusFilters = useAtomValue(evaluationRunsStatusFiltersAtom)
    const summary = useAtomValue(evaluationRunsFiltersSummaryAtom)
    const filterOptions = useAtomValue(evaluationRunsFilterOptionsAtom)
    const variantOptionsState = useAtomValue(evaluationRunsVariantOptionsAtom)
    const queryOptionsState = useAtomValue(evaluationRunsQueryOptionsAtom)
    const filtersContext = useAtomValue(evaluationRunsFiltersContextAtom)
    const {projectId} = useAtomValue(evaluationRunsTableComponentSliceAtom)
    const resetFilters = useSetAtom(evaluationRunsResetFiltersAtom)
    const setSearchValue = useSetAtom(evaluationRunsSearchInputAtom)
    const setMetaUpdater = useSetAtom(evaluationRunsMetaUpdaterAtom)
    const draft = useAtomValue(evaluationRunsFiltersDraftAtom)
    const setDraft = useSetAtom(evaluationRunsFiltersDraftAtom)
    const initializeDraft = useSetAtom(evaluationRunsFiltersDraftInitializeAtom)
    const clearDraft = useSetAtom(evaluationRunsFiltersDraftClearAtom)
    const testsetsQuery = useAtomValue(testsetsListQueryAtomFamily(null))
    const testsets = testsetsQuery.data?.testsets ?? []
    const testsetsLoading = testsetsQuery.isPending

    const draftStatusFilters = draft?.statusFilters ?? summary.statusFilters
    const draftReferences = draft?.referenceFilters ?? createReferenceDraftFromSummary(summary)
    const draftEvaluationTypes = draft?.evaluationTypes ?? summary.evaluationTypeFilters
    const draftDateRange = draft?.dateRange ?? summary.dateRange ?? null
    const summarySignature = useMemo(() => createSummarySignature(summary), [summary])

    const testsetOptions = useMemo(() => buildTestsetOptions(testsets), [testsets])

    useEffect(() => {
        if (isOpen) {
            initializeDraft()
        }
    }, [initializeDraft, isOpen, summarySignature])

    useEffect(() => {
        if (!isOpen) {
            clearDraft()
        }
    }, [clearDraft, isOpen])

    const handleStatusChange = useCallback(
        (values: (string | number)[]) => {
            const normalized = values.map((value) => String(value))
            setDraft((prev) => {
                if (!prev) return prev
                return {...prev, statusFilters: normalized}
            })
        },
        [setDraft],
    )

    const handleEvaluationTypeChange = useCallback(
        (values: (string | number)[]) => {
            const normalized = normalizeEvaluationTypes(values.map((value) => String(value)))
            setDraft((prev) => {
                if (!prev) return prev
                return {...prev, evaluationTypes: normalized}
            })
        },
        [setDraft],
    )

    const handleDateRangeChange = useCallback(
        (range: {from?: string | null; to?: string | null} | null) => {
            setDraft((prev) => {
                if (!prev) return prev
                return {...prev, dateRange: range}
            })
        },
        [setDraft],
    )

    const lockedReferenceSets = useMemo(
        () => ({
            testset: new Set(summary.lockedReferenceFilters?.testset ?? []),
            evaluator: new Set(summary.lockedReferenceFilters?.evaluator ?? []),
            app: new Set(summary.lockedReferenceFilters?.app ?? []),
            variant: new Set(summary.lockedReferenceFilters?.variant ?? []),
            query: new Set(summary.lockedReferenceFilters?.query ?? []),
        }),
        [summary.lockedReferenceFilters],
    )

    const enforceLockedValues = useCallback(
        (key: ReferenceFilterKey, values: string[]) => {
            const lockedValues = lockedReferenceSets[key]
            if (!lockedValues.size) {
                return values
            }
            const merged = Array.from(
                new Set(
                    [...values, ...lockedValues].map((value) =>
                        typeof value === "string" ? value.trim() : "",
                    ),
                ),
            ).filter((value) => value.length > 0)
            return merged
        },
        [lockedReferenceSets],
    )

    const handleReferenceChange = useCallback(
        (key: ReferenceFilterKey, values: string[]) => {
            const nextValues = enforceLockedValues(key, values)
            setDraft((prev) => {
                if (!prev) return prev
                return {
                    ...prev,
                    referenceFilters: {
                        ...prev.referenceFilters,
                        [key]: nextValues,
                    },
                }
            })
        },
        [enforceLockedValues, setDraft],
    )

    const handleReset = useCallback(() => {
        setSearchValue("")
        resetFilters()
        clearDraft()
        onClose()
    }, [clearDraft, onClose, resetFilters, setSearchValue])

    const persistedReferences = useMemo<DraftReferenceFilters>(
        () => createReferenceDraftFromSummary(summary),
        [summary],
    )

    const normalizedDraftStatuses = useMemo(
        () => normalizeStatusFilters(draftStatusFilters),
        [draftStatusFilters],
    )

    const normalizedPersistedStatuses = useMemo(
        () => normalizeStatusFilters(persistedStatusFilters),
        [persistedStatusFilters],
    )

    const normalizedDraftReferences = useMemo(
        () => normalizeReferenceFilters(draftReferences),
        [draftReferences],
    )

    const normalizedPersistedReferences = useMemo(
        () => normalizeReferenceFilters(persistedReferences),
        [persistedReferences],
    )

    const normalizedDraftEvaluationTypes = useMemo(
        () => normalizeEvaluationTypes(draftEvaluationTypes),
        [draftEvaluationTypes],
    )
    const normalizedPersistedEvaluationTypes = useMemo(
        () => normalizeEvaluationTypes(summary.evaluationTypeFilters),
        [summary.evaluationTypeFilters],
    )
    const normalizedDraftDateRange = useMemo(
        () => normalizeDateRange(draftDateRange),
        [draftDateRange],
    )
    const normalizedPersistedDateRange = useMemo(
        () => normalizeDateRange(summary.dateRange ?? null),
        [summary.dateRange],
    )

    const hasPendingChanges = useMemo(() => {
        if (!draft) {
            return false
        }
        if (
            normalizedDraftStatuses.length !== normalizedPersistedStatuses.length ||
            normalizedDraftStatuses.some(
                (value, index) => value !== normalizedPersistedStatuses[index],
            )
        ) {
            return true
        }

        if (
            JSON.stringify(normalizedDraftReferences ?? null) !==
            JSON.stringify(normalizedPersistedReferences ?? null)
        ) {
            return true
        }

        if (
            normalizedDraftEvaluationTypes.length !== normalizedPersistedEvaluationTypes.length ||
            normalizedDraftEvaluationTypes.some(
                (value, index) => value !== normalizedPersistedEvaluationTypes[index],
            )
        ) {
            return true
        }

        if (
            JSON.stringify(normalizedDraftDateRange ?? null) !==
            JSON.stringify(normalizedPersistedDateRange ?? null)
        ) {
            return true
        }

        return false
    }, [
        draft,
        normalizedDraftReferences,
        normalizedDraftStatuses,
        normalizedDraftEvaluationTypes,
        normalizedDraftDateRange,
        normalizedPersistedReferences,
        normalizedPersistedStatuses,
        normalizedPersistedEvaluationTypes,
        normalizedPersistedDateRange,
    ])

    const handleApply = useCallback(() => {
        if (!draft) {
            onClose()
            return
        }
        if (!hasPendingChanges) {
            onClose()
            return
        }

        const nextReferenceFilters = normalizeReferenceFilters(draftReferences)
        const nextStatusFilters = normalizeStatusFilters(draftStatusFilters)
        const nextEvaluationTypes = normalizeEvaluationTypes(draftEvaluationTypes)
        const nextDateRange = normalizeDateRange(draftDateRange)
        const evaluationTypePayload =
            filtersContext.evaluationKind === "all" && nextEvaluationTypes.length
                ? nextEvaluationTypes
                : null

        setMetaUpdater((prev) => ({
            ...prev,
            referenceFilters: nextReferenceFilters,
            statusFilters: nextStatusFilters.length ? nextStatusFilters : null,
            previewFlags: filtersContext.derivedPreviewFlags,
            evaluationTypeFilters: evaluationTypePayload,
            dateRange: nextDateRange,
        }))

        clearDraft()
        onClose()
    }, [
        draft,
        clearDraft,
        draftReferences,
        draftStatusFilters,
        hasPendingChanges,
        draftEvaluationTypes,
        draftDateRange,
        filtersContext.evaluationKind,
        onClose,
        setMetaUpdater,
    ])

    const preventTagMouseDown = (event: ReactMouseEvent) => {
        event.preventDefault()
        event.stopPropagation()
    }

    const referenceTagRenderers = useMemo(() => {
        const createRenderer = (key: ReferenceFilterKey) => (tagProps: TagRenderProps) => {
            const isLocked = lockedReferenceSets[key].has(tagProps.value as string)
            const {label, value, closable, onClose, className, style} = tagProps
            return (
                <Tag
                    className={className}
                    style={style}
                    onMouseDown={preventTagMouseDown}
                    closable={!isLocked && closable}
                    onClose={isLocked ? undefined : onClose}
                >
                    {label ?? value}
                </Tag>
            )
        }
        return {
            testset: createRenderer("testset"),
            evaluator: createRenderer("evaluator"),
            app: createRenderer("app"),
            variant: createRenderer("variant"),
            query: createRenderer("query"),
        }
    }, [lockedReferenceSets])

    const shouldShowEvaluatorSection =
        filtersContext.isAutoOrHuman ||
        filtersContext.evaluationKind === "online" ||
        filtersContext.evaluationKind === "all"
    const shouldShowQuerySection =
        filtersContext.evaluationKind === "online" || filtersContext.evaluationKind === "all"
    const shouldShowEvaluationTypeSection = true
    const evaluationTypeDisabled = filtersContext.evaluationKind !== "all"
    const shouldShowTestsetSection =
        filtersContext.evaluationKind !== "online" && Boolean(projectId)
    const shouldShowAppSection = filtersContext.evaluationKind !== "online"
    const shouldShowVariantSection = filtersContext.evaluationKind !== "online"
    const hasReferenceControls =
        shouldShowTestsetSection ||
        shouldShowEvaluatorSection ||
        shouldShowAppSection ||
        shouldShowVariantSection ||
        shouldShowQuerySection

    return (
        <>
            <div className="flex flex-col gap-3 min-w-[320px] min-h-[0] text-gray-700 bg-white px-5 py-4 rounded-[20px] shadow-[0_20px_45px_rgba(15,23,42,0.12)]">
                <div className="grid grid-cols-2 gap-3">
                    <Section title="Status">
                        <Select
                            mode="multiple"
                            allowClear
                            className={chipSelectClassName}
                            value={draftStatusFilters}
                            options={STATUS_OPTIONS}
                            optionFilterProp="label"
                            placeholder="Select statuses"
                            onChange={(values) => handleStatusChange(values as (string | number)[])}
                        />
                    </Section>

                    {shouldShowEvaluationTypeSection ? (
                        <Section title="Type">
                            <Select
                                mode="multiple"
                                allowClear
                                disabled={evaluationTypeDisabled}
                                className={chipSelectClassName}
                                value={draftEvaluationTypes}
                                options={EVALUATION_KIND_FILTER_OPTIONS}
                                optionFilterProp="label"
                                placeholder="Select evaluation types"
                                onChange={(values) =>
                                    handleEvaluationTypeChange(values as (string | number)[])
                                }
                            />
                            {/* {evaluationTypeDisabled ? (
                                <Typography.Text type="secondary" className="text-xs">
                                    Evaluation type is controlled by the selected tab.
                                </Typography.Text>
                            ) : null} */}
                        </Section>
                    ) : null}
                </div>

                {hasReferenceControls ? (
                    <>
                        <Divider className="!my-1" />
                        <FieldGrid>
                            {/* Order follows evaluation run graph: Input → Application → Evaluators */}
                            {/* For auto/human: Testset → App → Variant → Evaluators */}
                            {/* For online: Query → Evaluators */}
                            {shouldShowQuerySection ? (
                                <Section title="Queries">
                                    <Select
                                        mode="tags"
                                        className={chipSelectClassName}
                                        value={draftReferences.query}
                                        loading={queryOptionsState.isLoading}
                                        disabled={!queryOptionsState.enabled}
                                        tagRender={referenceTagRenderers.query}
                                        onChange={(values) =>
                                            handleReferenceChange("query", values as string[])
                                        }
                                        optionLabelProp="label"
                                        optionFilterProp="label"
                                        placeholder={
                                            queryOptionsState.enabled
                                                ? "Add query slugs or IDs"
                                                : "Queries unavailable"
                                        }
                                    >
                                        {queryOptionsState.options.map((option) => (
                                            <Select.Option
                                                key={option.value}
                                                value={option.value}
                                                label={option.label}
                                            >
                                                <QueryFilterOption option={option} />
                                            </Select.Option>
                                        ))}
                                    </Select>
                                </Section>
                            ) : null}
                            {shouldShowEvaluatorSection ? (
                                <Section title="Evaluators">
                                    <Select
                                        mode="tags"
                                        className={chipSelectClassName}
                                        value={draftReferences.evaluator}
                                        options={filterOptions.evaluatorOptions}
                                        loading={
                                            shouldShowEvaluatorSection &&
                                            filterOptions.evaluatorLoading
                                        }
                                        tagRender={referenceTagRenderers.evaluator}
                                        onChange={(values) =>
                                            handleReferenceChange("evaluator", values as string[])
                                        }
                                        placeholder="Add evaluator slugs"
                                    />
                                </Section>
                            ) : null}
                            {shouldShowTestsetSection ? (
                                <Section title="Test sets">
                                    <Select
                                        mode="tags"
                                        className={chipSelectClassName}
                                        value={draftReferences.testset}
                                        options={testsetOptions}
                                        loading={testsetsLoading}
                                        disabled={!projectId}
                                        tagRender={referenceTagRenderers.testset}
                                        onChange={(values) =>
                                            handleReferenceChange("testset", values as string[])
                                        }
                                        optionLabelProp="label"
                                        optionFilterProp="label"
                                        placeholder={
                                            projectId ? "Add testset IDs" : "Select a project first"
                                        }
                                    />
                                </Section>
                            ) : null}
                            {shouldShowAppSection ? (
                                <Section title="Applications">
                                    <Select
                                        mode="tags"
                                        className={chipSelectClassName}
                                        value={draftReferences.app}
                                        options={filterOptions.appOptions}
                                        loading={filterOptions.appsLoading}
                                        tagRender={referenceTagRenderers.app}
                                        onChange={(values) =>
                                            handleReferenceChange("app", values as string[])
                                        }
                                        placeholder="Add application IDs"
                                    />
                                </Section>
                            ) : null}
                            {shouldShowVariantSection ? (
                                <Section title="Variants">
                                    <Select
                                        mode="tags"
                                        className={chipSelectClassName}
                                        value={draftReferences.variant}
                                        options={variantOptionsState.options}
                                        loading={variantOptionsState.isLoading}
                                        disabled={!variantOptionsState.enabled}
                                        tagRender={referenceTagRenderers.variant}
                                        onChange={(values) =>
                                            handleReferenceChange("variant", values as string[])
                                        }
                                        placeholder={
                                            variantOptionsState.enabled
                                                ? "Add variant IDs"
                                                : "Select an application first"
                                        }
                                    />
                                </Section>
                            ) : null}
                        </FieldGrid>
                        <Divider className="!my-1" />
                    </>
                ) : null}

                <Section title="Date range">
                    <QuickDateRangePicker value={draftDateRange} onChange={handleDateRangeChange} />
                </Section>

                <Divider style={{margin: "8px 0"}} />
                <div className="flex justify-end gap-2">
                    <Button type="link" onClick={handleReset}>
                        Reset
                    </Button>
                    <Button type="primary" onClick={handleApply} disabled={!hasPendingChanges}>
                        Apply
                    </Button>
                </div>
            </div>
        </>
    )
}

export default EvaluationRunsFiltersContent
