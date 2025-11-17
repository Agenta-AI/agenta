import {memo, useCallback, useEffect, useMemo, useState} from "react"

import {Button, Checkbox, Input, List, Popover, Space, Tag, Tooltip, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {message} from "@/oss/components/AppMessageContext"
import dayjs from "@/oss/lib/helpers/dateTimeHelper/dayjs"

import {
    MAX_COMPARISON_RUNS,
    compareAvailabilityAtomFamily,
    compareRunIdsAtom,
    compareRunIdsWriteAtom,
    computeStructureFromRawRun,
} from "../atoms/compare"
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
    createdAt?: string
    testsetNames: string[]
    structure: {
        testsetIds: string[]
        hasQueryInput: boolean
        inputStepCount: number
    }
}

const reasonLabelMap: Record<string, string> = {
    loading: "Loading comparison availability…",
    "no-input": "Comparison requires at least one input step.",
    "no-testset": "Comparison is available only for testset-based evaluations.",
    "query-input": "Comparison is not supported for query-driven evaluations.",
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
        if (!availability.canCompare && compareIds.length) {
            setCompareIds([])
        }
    }, [availability.canCompare, compareIds, setCompareIds])

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

    const button = (
        <Button onClick={() => setOpen((prev) => !prev)} disabled={!availability.canCompare}>
            Compare{compareIds.length ? ` (${compareIds.length})` : ""}
        </Button>
    )

    return (
        <div>
            {disabledReason ? (
                <Tooltip title={disabledReason} placement="bottom">
                    <span>{button}</span>
                </Tooltip>
            ) : (
                <>{button}</>
            )}

            <Popover
                open={open && availability.canCompare}
                onOpenChange={setOpen}
                trigger={["click"]}
                placement="bottomRight"
                destroyOnHidden
                overlayStyle={{minWidth: 360}}
                content={
                    open && availability.canCompare ? (
                        <CompareRunsPopoverContent runId={runId} availability={availability} />
                    ) : null
                }
            />
        </div>
    )
}

export default memo(CompareRunsMenu)

interface CompareRunsPopoverContentProps {
    runId: string
    availability: {
        canCompare: boolean
        testsetIds: string[]
        isLoading: boolean
        reason?: keyof typeof reasonLabelMap
    }
}

const CompareRunsPopoverContent = memo(({runId, availability}: CompareRunsPopoverContentProps) => {
    const compareIds = useAtomValue(compareRunIdsAtom)
    const setCompareIds = useSetAtom(compareRunIdsWriteAtom)
    const [searchTerm, setSearchTerm] = useState("")

    const {runs, swrData} = usePreviewEvaluations({skip: !availability.canCompare})

    const candidates = useMemo<CandidateRun[]>(() => {
        if (!availability.canCompare || !Array.isArray(runs)) return []
        const baseTestsetIds = new Set(availability.testsetIds)
        return runs
            .filter((run) => run?.id && run.id !== runId)
            .map((run) => {
                const structure = computeStructureFromRawRun(run)
                return {
                    id: run.id,
                    name: run.name || "Untitled run",
                    status: run.status,
                    createdAt: run.createdAt ?? run.created_at,
                    testsetNames: Array.isArray(run.testsets)
                        ? run.testsets.map((t) => t?.name || "Unnamed testset")
                        : [],
                    structure,
                }
            })
            .filter((candidate) => {
                if (!candidate.structure.inputStepCount) return false
                if (candidate.structure.hasQueryInput) return false
                if (!candidate.structure.testsetIds.length) return false
                const sharesTestset = candidate.structure.testsetIds.some((id) =>
                    baseTestsetIds.has(id),
                )
                return sharesTestset
            })
    }, [availability.canCompare, availability.testsetIds, runs, runId])

    const filteredCandidates = useMemo(() => {
        if (!searchTerm.trim()) return candidates
        const query = searchTerm.trim().toLowerCase()
        return candidates.filter((candidate) => candidate.name.toLowerCase().includes(query))
    }, [candidates, searchTerm])

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

    const handleRemove = useCallback(
        (targetId: string) => {
            setCompareIds((prev) => prev.filter((id) => id !== targetId))
        },
        [setCompareIds],
    )

    const handleClearAll = useCallback(() => {
        setCompareIds([])
    }, [setCompareIds])

    const selectedDetails = useMemo(() => {
        const map = new Map<string, CandidateRun>()
        candidates.forEach((candidate) => {
            map.set(candidate.id, candidate)
        })
        return compareIds.map(
            (id) =>
                map.get(id) ?? {
                    id,
                    name: id,
                    status: undefined,
                    createdAt: undefined,
                    testsetNames: [],
                    structure: {testsetIds: [], hasQueryInput: false, inputStepCount: 0},
                },
        )
    }, [candidates, compareIds])

    return (
        <Space direction="vertical" style={{width: "100%"}} size="small">
            <div>
                <Space split={<span>/</span>} size={4} wrap>
                    {availability.testsetIds.length ? (
                        <Text type="secondary">
                            Matching testsets: {availability.testsetIds.join(", ")}
                        </Text>
                    ) : null}
                    <Text type="secondary">
                        Selected {compareIds.length}/{MAX_COMPARISON_RUNS}
                    </Text>
                </Space>
            </div>

            {compareIds.length ? (
                <Space size={[4, 4]} wrap>
                    {selectedDetails.map((run) => (
                        <Tag
                            key={run.id}
                            closable
                            onClose={(event) => {
                                event.preventDefault()
                                handleRemove(run.id)
                            }}
                        >
                            {run.name}
                        </Tag>
                    ))}
                    <Button size="small" type="link" onClick={handleClearAll}>
                        Clear
                    </Button>
                </Space>
            ) : null}

            <Input
                placeholder="Search evaluations"
                allowClear
                size="small"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
            />

            <List
                size="small"
                bordered
                dataSource={filteredCandidates}
                locale={{
                    emptyText: swrData.isLoading
                        ? "Loading evaluations…"
                        : "No matching evaluations",
                }}
                renderItem={(item) => {
                    const isChecked = compareIds.includes(item.id)
                    const createdLabel = item.createdAt
                        ? dayjs(item.createdAt).format("DD MMM YYYY")
                        : ""
                    return (
                        <List.Item
                            key={item.id}
                            onClick={() => handleToggle(item.id)}
                            style={{cursor: "pointer"}}
                        >
                            <Space direction="vertical" size={0} style={{width: "100%"}}>
                                <Space align="start" style={{width: "100%"}}>
                                    <Checkbox checked={isChecked}>
                                        <Text strong>{item.name}</Text>
                                    </Checkbox>
                                    <Space size={4} wrap>
                                        {item.status ? <Tag color="blue">{item.status}</Tag> : null}
                                        {createdLabel ? (
                                            <Text type="secondary" style={{fontSize: 12}}>
                                                {createdLabel}
                                            </Text>
                                        ) : null}
                                    </Space>
                                </Space>
                                {item.testsetNames.length ? (
                                    <Text type="secondary" style={{fontSize: 12}}>
                                        Testsets: {item.testsetNames.join(", ")}
                                    </Text>
                                ) : null}
                            </Space>
                        </List.Item>
                    )
                }}
            />
        </Space>
    )
})
