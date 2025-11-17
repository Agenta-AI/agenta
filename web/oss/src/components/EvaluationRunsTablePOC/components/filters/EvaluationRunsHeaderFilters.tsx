import {MouseEvent, useMemo, useState, useCallback} from "react"

import {Input, Tag, Tooltip, Typography} from "antd"
import clsx from "clsx"
import {atom, useAtom, useAtomValue, useSetAtom} from "jotai"

import {FiltersPopoverTrigger} from "@/oss/components/InfiniteVirtualTable"
import {
    getReferenceToneColors,
    type ReferenceTone,
} from "@/oss/components/References/referenceColors"
import {useTestsetsData} from "@/oss/state/testset"

import {evaluationRunsTableComponentSliceAtom} from "../../atoms/context"
import {
    evaluationRunsFilterOptionsAtom,
    evaluationRunsFiltersSummaryAtom,
    evaluationRunsQueryOptionsAtom,
    evaluationRunsReferenceFiltersAtom,
    evaluationRunsSearchInputAtom,
    evaluationRunsVariantOptionsAtom,
    evaluationRunsStatusFiltersAtom,
    evaluationRunsFlagToggleAtom,
    evaluationRunsFiltersButtonStateAtom,
    evaluationRunsTypeFiltersAtom,
    evaluationRunsDateRangeAtom,
} from "../../atoms/view"
import {STATUS_OPTIONS, type FlagKey, EVALUATION_KIND_LABELS} from "../../constants"
import type {ConcreteEvaluationRunKind} from "../../types"
import {buildTestsetOptions} from "../../utils/testsetOptions"

import EvaluationRunsFiltersContent from "./EvaluationRunsFiltersContent"

const optionMap = (options: {value: string; label: string}[] = []) =>
    new Map(options.map(({value, label}) => [value, label]))

type ChipKind =
    | "status"
    | "evaluator"
    | "query"
    | "app"
    | "variant"
    | "testset"
    | "flag"
    | "evaluationType"
    | "dateRange"

interface FilterChip {
    value: string
    label: string
    closable: boolean
    pending?: boolean
}

interface FilterGroup {
    label: string
    kind: ChipKind
    chips: FilterChip[]
}

const emptyFilterOptionsAtom = atom({
    evaluatorOptions: [],
    evaluatorLoading: false,
    appOptions: [],
    appsLoading: false,
})

const emptyVariantOptionsAtom = atom({
    options: [],
    enabled: false,
    isLoading: false,
})

const emptyQueryOptionsAtom = atom({
    options: [],
    enabled: false,
    isLoading: false,
})

const REFERENCE_CHIP_TONES: Partial<Record<ChipKind, ReferenceTone>> = {
    evaluator: "evaluator",
    app: "app",
    variant: "variant",
    testset: "testset",
    query: "query",
    evaluationType: undefined,
    dateRange: undefined,
}

const buildPendingLabel = (value: string, label: string | undefined) => {
    if (label && label !== value) {
        return label
    }
    return "Loading…"
}

const isReferenceChipPending = (payload: {label?: string; value: string; loading: boolean}) => {
    if (payload.loading) return true
    if (!payload.label) return true
    if (payload.label === payload.value) return true
    return false
}

const FiltersSummary = () => {
    const summary = useAtomValue(evaluationRunsFiltersSummaryAtom)
    const {projectId} = useAtomValue(evaluationRunsTableComponentSliceAtom)
    const {testsets, isLoading: testsetsLoading} = useTestsetsData({
        enabled: Boolean(projectId && summary.testsetFilters.length > 0),
    })
    const hasEvaluatorFilters = summary.evaluatorFilters.length > 0
    const hasAppFilters = summary.appFilters.length > 0
    const hasVariantFilters = summary.variantFilters.length > 0
    const hasQueryFilters = summary.queryFilters.length > 0

    const filterOptionsAtom = useMemo(
        () =>
            hasEvaluatorFilters || hasAppFilters
                ? evaluationRunsFilterOptionsAtom
                : emptyFilterOptionsAtom,
        [hasAppFilters, hasEvaluatorFilters],
    )
    const variantOptionsAtom = useMemo(
        () => (hasVariantFilters ? evaluationRunsVariantOptionsAtom : emptyVariantOptionsAtom),
        [hasVariantFilters],
    )
    const queryOptionsAtom = useMemo(
        () => (hasQueryFilters ? evaluationRunsQueryOptionsAtom : emptyQueryOptionsAtom),
        [hasQueryFilters],
    )

    const filterOptions = useAtomValue(filterOptionsAtom)
    const variantOptions = useAtomValue(variantOptionsAtom)
    const queryOptions = useAtomValue(queryOptionsAtom)
    const testsetOptions = useMemo(() => buildTestsetOptions(testsets), [testsets])
    const setStatusFilters = useSetAtom(evaluationRunsStatusFiltersAtom)
    const setReferenceFilters = useSetAtom(evaluationRunsReferenceFiltersAtom)
    const setEvaluationTypeFilters = useSetAtom(evaluationRunsTypeFiltersAtom)
    const setDateRange = useSetAtom(evaluationRunsDateRangeAtom)
    const toggleFlag = useSetAtom(evaluationRunsFlagToggleAtom)

    const statusLabels = useMemo(() => optionMap(STATUS_OPTIONS), [])
    const evaluatorLabels = useMemo(
        () => optionMap(filterOptions.evaluatorOptions ?? []),
        [filterOptions.evaluatorOptions],
    )
    const appLabels = useMemo(
        () => optionMap(filterOptions.appOptions ?? []),
        [filterOptions.appOptions],
    )
    const variantLabels = useMemo(
        () =>
            optionMap(
                (variantOptions.options ?? []).map((opt) => ({value: opt.value, label: opt.label})),
            ),
        [variantOptions.options],
    )
    const queryLabels = useMemo(
        () =>
            new Map(
                (queryOptions.options ?? []).map((opt) => [
                    opt.value,
                    opt.label ?? opt.summary ?? opt.value,
                ]),
            ),
        [queryOptions.options],
    )
    const testsetLabels = useMemo(() => optionMap(testsetOptions), [testsetOptions])

    const lockedFlagSet = useMemo(
        () => new Set(summary.lockedFlagKeys ?? []),
        [summary.lockedFlagKeys],
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

    const evaluationTypeLabels = useMemo(
        () => new Map<string, string>(Object.entries(EVALUATION_KIND_LABELS)),
        [],
    )

    const evaluationKindLocked = summary.evaluationKind !== "all"

    const groups = useMemo<FilterGroup[]>(() => {
        const result: FilterGroup[] = []
        const formatDateLabel = (value?: string | null) => {
            if (!value) return null
            try {
                return new Intl.DateTimeFormat(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "numeric",
                }).format(new Date(value))
            } catch {
                return value
            }
        }

        const push = (
            label: string,
            values: string[],
            kind: ChipKind,
            map: Map<string, string>,
            isClosable?: (value: string) => boolean,
            loading?: boolean,
        ) => {
            if (!values.length) return
            result.push({
                label,
                kind,
                chips: values.map((value) => ({
                    value,
                    label: isReferenceChipPending({
                        label: map.get(value),
                        value,
                        loading: Boolean(loading),
                    })
                        ? buildPendingLabel(value, map.get(value))
                        : (map.get(value) ?? value),
                    closable: isClosable ? isClosable(value) : true,
                    pending: isReferenceChipPending({
                        label: map.get(value),
                        value,
                        loading: Boolean(loading),
                    }),
                })),
            })
        }

        push("Status", summary.statusFilters, "status", statusLabels)
        push(
            "Evaluation Type",
            summary.evaluationTypeFilters,
            "evaluationType",
            evaluationTypeLabels,
            () => !evaluationKindLocked,
        )
        if (summary.dateRange?.from || summary.dateRange?.to) {
            const fromLabel = formatDateLabel(summary.dateRange?.from)
            const toLabel = formatDateLabel(summary.dateRange?.to)
            const labelParts = [
                fromLabel ? `From ${fromLabel}` : null,
                toLabel ? `To ${toLabel}` : null,
            ].filter(Boolean)
            const labelValue = labelParts.join(" • ") || "Date range"
            result.push({
                label: "Date",
                kind: "dateRange",
                chips: [
                    {
                        value: "date-range",
                        label: labelValue,
                        closable: true,
                    },
                ],
            })
        }
        push(
            "Evaluators",
            summary.evaluatorFilters,
            "evaluator",
            evaluatorLabels,
            (value) => !lockedReferenceSets.evaluator.has(value),
            filterOptions.evaluatorLoading,
        )
        push(
            "Queries",
            summary.queryFilters,
            "query",
            queryLabels,
            (value) => !lockedReferenceSets.query.has(value),
            queryOptions.isLoading,
        )
        push(
            "Apps",
            summary.appFilters,
            "app",
            appLabels,
            (value) => !lockedReferenceSets.app.has(value),
            filterOptions.appsLoading,
        )
        push(
            "Variants",
            summary.variantFilters,
            "variant",
            variantLabels,
            (value) => !lockedReferenceSets.variant.has(value),
            variantOptions.isLoading,
        )
        push(
            "Testsets",
            summary.testsetFilters,
            "testset",
            testsetLabels,
            (value) => !lockedReferenceSets.testset.has(value),
            testsetsLoading,
        )

        const flagChips = Object.entries(summary.mergedFlags ?? {})
            .filter(([, value]) => value === true)
            .map(([key]) => ({
                value: key,
                label: key
                    .replace(/^is[_-]?/, "")
                    .replace(/_/g, " ")
                    .replace(/\b\w/g, (char) => char.toUpperCase()),
                closable: !lockedFlagSet.has(key),
            }))
        if (flagChips.length) {
            result.push({
                label: "Flags",
                kind: "flag",
                chips: flagChips,
            })
        }

        return result
    }, [
        summary,
        statusLabels,
        evaluatorLabels,
        queryLabels,
        appLabels,
        variantLabels,
        testsetLabels,
        lockedFlagSet,
        lockedReferenceSets,
        evaluationTypeLabels,
        evaluationKindLocked,
        testsetsLoading,
    ])

    const removeReferenceValue = (
        key: "testset" | "evaluator" | "app" | "variant" | "query",
        value: string,
    ) => {
        const nextValues = (summary.referenceFilters?.[key] ?? []).filter(
            (entry) => entry !== value,
        )
        setReferenceFilters({key, values: nextValues})
    }

    const handleChipClose = (kind: ChipKind, value: string) => (event: MouseEvent) => {
        event.preventDefault()
        event.stopPropagation()
        switch (kind) {
            case "status": {
                const next = summary.statusFilters.filter((status) => status !== value)
                setStatusFilters(next)
                break
            }
            case "evaluator":
            case "app":
            case "variant":
            case "query": {
                removeReferenceValue(kind, value)
                break
            }
            case "testset": {
                removeReferenceValue(kind, value)
                break
            }
            case "evaluationType": {
                const next = summary.evaluationTypeFilters.filter((type) => type !== value)
                setEvaluationTypeFilters(next as ConcreteEvaluationRunKind[])
                break
            }
            case "flag": {
                toggleFlag({flag: value as FlagKey, checked: false})
                break
            }
            case "dateRange": {
                setDateRange(null)
                break
            }
            default:
                break
        }
    }

    if (!groups.length) {
        return (
            <Typography.Text className="text-xs text-[#98A2B3] whitespace-nowrap">
                No filters applied
            </Typography.Text>
        )
    }

    return (
        <div className="flex gap-2 text-xs text-[#475467] grow overflow-x-auto">
            {groups.map((group) =>
                group.chips.map((chip) => {
                    const tone = REFERENCE_CHIP_TONES[group.kind]
                    const toneColors = getReferenceToneColors(tone)
                    return (
                        <Tag
                            key={`${group.label}:${chip.value}`}
                            closable={chip.closable && !chip.pending}
                            onClose={
                                chip.closable && !chip.pending
                                    ? handleChipClose(group.kind, chip.value)
                                    : undefined
                            }
                            className={clsx(
                                "m-0 px-2 py-0.5 text-xs border border-solid rounded",
                                toneColors
                                    ? "hover:brightness-95"
                                    : "text-[#475467] bg-[#F2F4F7] border-transparent",
                            )}
                            style={
                                toneColors
                                    ? {
                                          backgroundColor: toneColors.background,
                                          borderColor: toneColors.border,
                                          color: toneColors.text,
                                      }
                                    : undefined
                            }
                        >
                            <Tooltip
                                title={
                                    chip.pending
                                        ? "Loading…"
                                        : chip.closable
                                          ? undefined
                                          : "Preset by context; change scope to remove"
                                }
                            >
                                <span className={toneColors ? "text-inherit" : undefined}>
                                    <span className="font-medium text-[#101828]">
                                        {group.label}:
                                    </span>{" "}
                                    {chip.label}
                                </span>
                            </Tooltip>
                        </Tag>
                    )
                }),
            )}
        </div>
    )
}

const EvaluationRunsHeaderFilters = () => {
    const [searchValue, setSearchValue] = useAtom(evaluationRunsSearchInputAtom)
    const filtersButtonState = useAtomValue(evaluationRunsFiltersButtonStateAtom)
    const [isFiltersOpen, setIsFiltersOpen] = useState(false)
    const handleFiltersOpenChange = useCallback((open: boolean) => {
        setIsFiltersOpen(open)
    }, [])

    return (
        <div className="flex gap-2 flex-1 items-center min-w-[320px] shrink">
            <Input
                allowClear
                placeholder="Search evaluations"
                className="min-w-0 shrink max-w-[320px]"
                value={searchValue}
                onChange={(event) => setSearchValue(event.target.value)}
                style={{minWidth: 220}}
            />
            <FiltersPopoverTrigger
                label={filtersButtonState.label}
                buttonType={filtersButtonState.buttonType as "default" | "primary"}
                onOpenChange={handleFiltersOpenChange}
                popoverProps={{
                    overlayStyle: {
                        backgroundColor: "transparent",
                        boxShadow: "none",
                        padding: 0,
                    },
                    arrow: false,
                    styles: {
                        body: {
                            backgroundColor: "transparent",
                            boxShadow: "none",
                            border: "none",
                        },
                    },
                }}
                renderContent={(close) => (
                    <EvaluationRunsFiltersContent isOpen={isFiltersOpen} onClose={close} />
                )}
            />
            <FiltersSummary />
        </div>
    )
}

export default EvaluationRunsHeaderFilters
