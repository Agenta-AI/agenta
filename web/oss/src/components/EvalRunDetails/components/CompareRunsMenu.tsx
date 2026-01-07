import {memo, useCallback, useEffect, useMemo, useState} from "react"

import {Button, Checkbox, Input, List, Popover, Space, Tag, Tooltip, Typography} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"
import Image from "next/image"

import {message} from "@/oss/components/AppMessageContext"
import EmptyComponent from "@/oss/components/Placeholders/EmptyComponent"
import ReferenceTag from "@/oss/components/References/ReferenceTag"
import axios from "@/oss/lib/api/assets/axiosConfig"
import dayjs from "@/oss/lib/helpers/dateTimeHelper/dayjs"
import {projectIdAtom} from "@/oss/state/project"

import {
    MAX_COMPARISON_RUNS,
    compareAvailabilityAtomFamily,
    compareRunIdsAtom,
    compareRunIdsWriteAtom,
    computeStructureFromRawRun,
    isTerminalStatus,
} from "../atoms/compare"
import useRunScopedUrls from "../hooks/useRunScopedUrls"
import {setCompareQueryParams} from "../state/urlCompare"

import usePreviewEvaluations from "@/agenta-oss-common/lib/hooks/usePreviewEvaluations"

const {Text} = Typography

interface CompareRunsMenuProps {
    runId: string
}

interface CandidateRun {
    id: string
    name: string
    status?: string
    description?: string | null
    createdAt?: string
    testsetNames: string[]
    structure: {
        testsetIds: string[]
        hasQueryInput: boolean
        inputStepCount: number
        evaluatorIds: string[]
    }
}

const reasonLabelMap: Record<string, string> = {
    loading: "Loading comparison availability…",
    "no-input": "Comparison requires at least one input step.",
    "no-testset": "Comparison is available only for testset-based evaluations.",
    "query-input": "Comparison is not supported for query-driven evaluations.",
    "pending-status": "Comparison is only available for completed evaluation runs.",
}

const CompareRunsMenu = ({runId}: CompareRunsMenuProps) => {
    const compareIds = useAtomValue(compareRunIdsAtom)
    const setCompareIds = useSetAtom(compareRunIdsWriteAtom)
    const availabilityAtom = useMemo(() => compareAvailabilityAtomFamily(runId), [runId])
    const availability = useAtomValue(availabilityAtom)

    const [open, setOpen] = useState(false)
    useEffect(() => {
        setCompareQueryParams(compareIds)
    }, [compareIds])

    useEffect(() => {
        // Only clear compare IDs if we're done loading and comparison is not available
        // Don't clear while still loading to preserve URL-restored state
        if (!availability.isLoading && !availability.canCompare && compareIds.length) {
            setCompareIds([])
        }
    }, [availability.isLoading, availability.canCompare, compareIds, setCompareIds])

    useEffect(() => {
        if (compareIds.length && compareIds.includes(runId)) {
            setCompareIds((prev) => prev.filter((id) => id !== runId))
        }
    }, [compareIds, runId, setCompareIds])

    const disabledReason = availability.isLoading
        ? reasonLabelMap.loading
        : availability.reason
          ? reasonLabelMap[availability.reason]
          : undefined

    const handleButtonClick = useCallback(() => {
        setOpen((prev) => !prev)
    }, [])

    const handlePopoverOpenChange = useCallback((newOpen: boolean) => {
        // Only allow the popover to close itself (e.g., clicking outside)
        // The button handles its own toggle
        if (!newOpen) {
            setOpen(false)
        }
    }, [])

    const button = (
        <Button type="primary" onClick={handleButtonClick} disabled={!availability.canCompare}>
            Compare{compareIds.length ? ` (${compareIds.length})` : ""}
        </Button>
    )

    return (
        <Popover
            open={open && availability.canCompare}
            onOpenChange={handlePopoverOpenChange}
            trigger={["click"]}
            placement="bottomRight"
            destroyOnHidden
            className="[&_.ant-popover-container]:p-0"
            overlayClassName="[&_.ant-popover-container]:p-0"
            styles={{root: {minWidth: 360, maxHeight: 440}}}
            content={
                open && availability.canCompare ? (
                    <CompareRunsPopoverContent runId={runId} availability={availability} />
                ) : null
            }
        >
            {disabledReason ? (
                <Tooltip title={disabledReason} placement="bottom">
                    <span>{button}</span>
                </Tooltip>
            ) : (
                button
            )}
        </Popover>
    )
}

export default memo(CompareRunsMenu)

interface CompareRunsPopoverContentProps {
    runId: string
    availability: {
        canCompare: boolean
        testsetIds: string[]
        evaluatorIds: string[]
        isLoading: boolean
        reason?: keyof typeof reasonLabelMap
    }
}

const CompareRunsPopoverContent = memo(({runId, availability}: CompareRunsPopoverContentProps) => {
    const compareIds = useAtomValue(compareRunIdsAtom)
    const setCompareIds = useSetAtom(compareRunIdsWriteAtom)
    const [searchTerm, setSearchTerm] = useState("")
    const [statusFilter, setStatusFilter] = useState<StatusFilterOption>("all")

    const {runs, swrData} = usePreviewEvaluations({skip: !availability.canCompare})
    const matchingTestsetNameMap = useTestsetNameMap(availability.testsetIds)
    const {buildTestsetHref} = useRunScopedUrls(runId)

    const candidates = useMemo<CandidateRun[]>(() => {
        if (!availability.canCompare || !Array.isArray(runs)) return []
        const baseTestsetIds = new Set(availability.testsetIds)
        const baseEvaluatorIds = new Set(availability.evaluatorIds)
        return runs
            .filter((run) => run?.id && run.id !== runId)
            .map((run) => {
                const structure = computeStructureFromRawRun(run)
                return {
                    id: run.id,
                    name: run.name || "Untitled run",
                    status: run.status,
                    description: (run as any)?.description ?? (run as any)?.summary ?? null,
                    createdAt: run.createdAt ?? run.created_at,
                    testsetNames: Array.isArray(run.testsets)
                        ? run.testsets.map((t) => t?.name || "Unnamed testset")
                        : [],
                    structure,
                }
            })
            .filter((candidate) => {
                // Only allow completed runs (terminal status)
                if (!isTerminalStatus(candidate.status)) return false
                if (!candidate.structure.inputStepCount) return false
                if (candidate.structure.hasQueryInput) return false
                if (!candidate.structure.testsetIds.length) return false
                // Must share at least one testset
                const sharesTestset = candidate.structure.testsetIds.some((id) =>
                    baseTestsetIds.has(id),
                )
                if (!sharesTestset) return false
                // Must share at least one evaluator for meaningful comparison
                const sharesEvaluator = candidate.structure.evaluatorIds.some((id) =>
                    baseEvaluatorIds.has(id),
                )
                return sharesEvaluator
            })
    }, [availability.canCompare, availability.testsetIds, availability.evaluatorIds, runs, runId])

    const candidateTestsetIds = useMemo(() => {
        const ids = new Set<string>()
        candidates.forEach((candidate) => {
            candidate.structure.testsetIds.forEach((id) => ids.add(id))
        })
        return Array.from(ids)
    }, [candidates])
    const candidateTestsetNameMap = useTestsetNameMap(candidateTestsetIds)

    const filteredCandidates = useMemo(() => {
        const query = searchTerm.trim().toLowerCase()
        return candidates.filter((candidate) => {
            const matchesSearch = query ? candidate.name.toLowerCase().includes(query) : true
            if (!matchesSearch) return false

            if (statusFilter === "all") return true
            const tone = candidate.status ? resolveStatusTone(candidate.status) : "default"
            if (statusFilter === "other") {
                return !["success", "error", "processing"].includes(tone)
            }
            return tone === statusFilter
        })
    }, [candidates, searchTerm, statusFilter])

    const hasLoadedRuns = Boolean((swrData as any)?.data)
    const showLoading = Boolean(swrData.isLoading && !hasLoadedRuns)
    const showEmptyState = !showLoading && filteredCandidates.length === 0

    const handleToggle = useCallback(
        (targetId: string) => {
            setCompareIds((prev) => {
                const exists = prev.includes(targetId)
                if (exists) {
                    return prev.filter((id) => id !== targetId)
                }
                if (prev.length >= MAX_COMPARISON_RUNS) {
                    message.info(`You can compare up to ${MAX_COMPARISON_RUNS} runs at a time.`)
                    return prev
                }
                return [...prev, targetId]
            })
        },
        [setCompareIds],
    )

    const handleClearAll = useCallback(() => {
        setCompareIds([])
    }, [setCompareIds])

    return (
        <Space
            orientation="vertical"
            style={{width: "100%"}}
            size="small"
            className="compare-runs-popover"
        >
            <div className="compare-runs-header">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                        <Text className="whitespace-nowrap text-[#475467]">Testset:</Text>
                        {availability.testsetIds.length ? (
                            <div className="flex flex-wrap gap-1 min-w-0 compare-runs-match-tags">
                                {availability.testsetIds.map((id) => {
                                    const label = matchingTestsetNameMap[id] ?? id
                                    const copyValue = id
                                    const href = buildTestsetHref(id)

                                    return (
                                        <TestsetReferenceTag
                                            key={id}
                                            label={label}
                                            copyValue={copyValue}
                                            href={href ?? undefined}
                                        />
                                    )
                                })}
                            </div>
                        ) : (
                            <Text type="secondary">—</Text>
                        )}
                    </div>
                    <Space size={8}>
                        <Text className="whitespace-nowrap">
                            Selected: {compareIds.length}/{MAX_COMPARISON_RUNS}
                        </Text>
                        {compareIds.length ? (
                            <Button
                                size="small"
                                type="link"
                                className="underline hover:no-underline"
                                onClick={handleClearAll}
                            >
                                Clear all
                            </Button>
                        ) : null}
                    </Space>
                </div>

                <Input
                    placeholder="Search"
                    allowClear
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    bordered={false}
                />

                <StatusFilterChips
                    activeFilter={statusFilter}
                    onChange={setStatusFilter}
                    availableCandidates={candidates}
                />
            </div>

            {showLoading ? (
                <div className="flex items-center justify-center py-10 text-[#98A2B3] text-sm">
                    Loading evaluations...
                </div>
            ) : showEmptyState ? (
                <div className="py-12">
                    <EmptyComponent
                        image={
                            <Image
                                src="/assets/not-found.png"
                                alt="No evaluations to compare"
                                width={200}
                                height={160}
                            />
                        }
                        description={
                            <div className="flex flex-col items-center gap-2 text-center">
                                <div className="text-base font-medium text-[#101828]">
                                    No evaluations to compare
                                </div>
                                <div className="text-sm text-[#667085] max-w-[280px]">
                                    Run another evaluation using the same test set to enable
                                    comparison.
                                </div>
                            </div>
                        }
                    />
                </div>
            ) : (
                <List
                    size="small"
                    dataSource={filteredCandidates}
                    split={false}
                    className="compare-runs-list"
                    style={{maxHeight: 360, overflowY: "auto"}}
                    locale={{emptyText: "No matching evaluations"}}
                    renderItem={(item) => {
                        const isChecked = compareIds.includes(item.id)
                        const createdLabel = item.createdAt
                            ? dayjs(item.createdAt).format("DD MMM YYYY")
                            : ""

                        return (
                            <List.Item
                                key={item.id}
                                onClick={() => handleToggle(item.id)}
                                className={clsx(
                                    "compare-run-row flex flex-col !items-start justify-start",
                                    "!py-1 !px-2",
                                    "border-b border-[#EAEFF5]",
                                    "last:border-b-0",
                                    isChecked && "compare-run-row--selected",
                                )}
                                style={{borderBottomStyle: "solid"}}
                            >
                                <div className="compare-run-row__main">
                                    <Checkbox
                                        className="compare-run-checkbox"
                                        checked={isChecked}
                                        onClick={(event) => event.stopPropagation()}
                                        onChange={(event) => {
                                            event.stopPropagation()
                                            handleToggle(item.id)
                                        }}
                                    >
                                        <div className="flex flex-col gap-1">
                                            <Text>{item.name}</Text>
                                            <Text
                                                type="secondary"
                                                style={{fontSize: 12}}
                                                className="text-left"
                                            >
                                                {item.description?.trim()
                                                    ? item.description
                                                    : "No description"}
                                            </Text>
                                        </div>
                                    </Checkbox>

                                    <Space
                                        size={4}
                                        align="end"
                                        className="compare-run-row__meta"
                                        orientation="vertical"
                                    >
                                        {item.status ? <StatusChip status={item.status} /> : null}
                                        {createdLabel ? (
                                            <Text type="secondary" style={{fontSize: 12}}>
                                                {createdLabel}
                                            </Text>
                                        ) : null}
                                    </Space>
                                </div>
                            </List.Item>
                        )
                    }}
                />
            )}
        </Space>
    )
})

type StatusTone = "success" | "error" | "processing" | "warning" | "default"
type StatusFilterOption = StatusTone | "all" | "other"

const STATUS_COLOR_MAP: Record<StatusTone, {background: string; text: string}> = {
    success: {background: "#ECFDF3", text: "#027A48"},
    error: {background: "#FEF3F2", text: "#B42318"},
    processing: {background: "#EFF8FF", text: "#175CD3"},
    warning: {background: "#FFFAEB", text: "#B54708"},
    default: {background: "#F2F4F7", text: "#344054"},
}

const normalizeStatusLabel = (value: string) =>
    value
        .toString()
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .replace(/\b\w/g, (ch) => ch.toUpperCase())

const resolveStatusTone = (status: string): StatusTone => {
    const normalized = status.toLowerCase()
    if (normalized.includes("success") || normalized.includes("complete")) return "success"
    if (normalized.includes("fail") || normalized.includes("error")) return "error"
    if (normalized.includes("warn") || normalized.includes("degrade")) return "warning"
    if (
        normalized.includes("run") ||
        normalized.includes("progress") ||
        normalized.includes("queue") ||
        normalized.includes("active") ||
        normalized.includes("pending")
    )
        return "processing"
    return "default"
}

const StatusChip = ({status}: {status: string}) => {
    const tone = resolveStatusTone(status)
    const colors = STATUS_COLOR_MAP[tone]
    return (
        <Tag
            bordered={false}
            style={{
                backgroundColor: colors.background,
                color: colors.text,
                fontWeight: 600,
            }}
        >
            {normalizeStatusLabel(status)}
        </Tag>
    )
}

const TestsetReferenceTag = ({
    label,
    copyValue,
    href,
}: {
    label: string
    copyValue?: string
    href?: string
}) => (
    <ReferenceTag
        label={label}
        copyValue={copyValue}
        href={href}
        className="max-w-[200px]"
        showIcon={false}
    />
)

const STATUS_FILTER_OPTIONS: {key: StatusFilterOption; label: string}[] = [
    {key: "all", label: "All"},
    {key: "success", label: "Success"},
    {key: "processing", label: "Running"},
    {key: "error", label: "Errors"},
    {key: "other", label: "Other"},
]

const StatusFilterChips = memo(
    ({
        activeFilter,
        onChange,
        availableCandidates,
    }: {
        activeFilter: StatusFilterOption
        onChange: (value: StatusFilterOption) => void
        availableCandidates: CandidateRun[]
    }) => {
        const counts = useMemo(() => {
            const tally: Record<StatusTone, number> = {
                success: 0,
                error: 0,
                processing: 0,
                warning: 0,
                default: 0,
            }
            availableCandidates.forEach((candidate) => {
                const tone = candidate.status ? resolveStatusTone(candidate.status) : "default"
                tally[tone] += 1
            })
            return tally
        }, [availableCandidates])

        if (!availableCandidates.length) {
            return null
        }

        const renderCount = (filter: StatusFilterOption) => {
            if (filter === "all") return availableCandidates.length
            if (filter === "other") {
                return counts.default + counts.warning
            }
            return counts[filter]
        }

        return (
            <div className="compare-runs-status-filters">
                <Text type="secondary" className="compare-runs-status-filters__label">
                    Filters:
                </Text>
                <Space size={[4, 4]} wrap>
                    {STATUS_FILTER_OPTIONS.map((option) => (
                        <Button
                            key={option.key}
                            size="small"
                            type={option.key === activeFilter ? "primary" : "default"}
                            ghost={false}
                            onClick={() => onChange(option.key)}
                            className={
                                option.key === activeFilter
                                    ? "compare-runs-filter-active"
                                    : undefined
                            }
                        >
                            {option.label} ({renderCount(option.key)})
                        </Button>
                    ))}
                </Space>
            </div>
        )
    },
)

const useTestsetNameMap = (testsetIds: string[]) => {
    const projectId = useAtomValue(projectIdAtom)
    const [names, setNames] = useState<Record<string, string>>({})
    const memoizedIds = useMemo(() => {
        const unique = Array.from(new Set(testsetIds.filter((id): id is string => Boolean(id))))
        return {
            key: unique.join("|"),
            ids: unique,
        }
    }, [testsetIds])
    const idsKey = memoizedIds.key

    useEffect(() => {
        if (!projectId || !memoizedIds.ids.length) {
            setNames({})
            return
        }
        let cancelled = false
        const fetchNames = async () => {
            try {
                const response = await axios.post(
                    "/preview/testsets/query",
                    {
                        testset_refs: memoizedIds.ids.map((id) => ({id})),
                        include_archived: true,
                        windowing: {limit: memoizedIds.ids.length},
                    },
                    {params: {project_id: projectId}},
                )
                const payload = response?.data ?? {}
                const list = Array.isArray(payload?.testsets)
                    ? payload.testsets
                    : Array.isArray(payload)
                      ? payload
                      : []
                const lookup: Record<string, string> = {}
                list.forEach((item: any) => {
                    if (!item?.id) return
                    lookup[item.id] = item?.name ?? item?.slug ?? item.id
                })
                if (!cancelled) {
                    setNames(lookup)
                }
            } catch (error) {
                if (!cancelled) {
                    setNames({})
                    console.error("Failed to fetch testset names:", error)
                    message.error("Failed to load testset names. Please try again later.")
                }
            }
        }
        fetchNames()
        return () => {
            cancelled = true
        }
    }, [projectId, idsKey])

    return names
}
