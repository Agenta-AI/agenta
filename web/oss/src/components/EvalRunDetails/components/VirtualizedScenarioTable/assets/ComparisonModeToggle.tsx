import React, {memo, useEffect, useMemo, useRef, useState} from "react"

import {CloseOutlined, PlusOutlined, SwapOutlined} from "@ant-design/icons"
import {Button, Modal, Select, Space, Tag, Tooltip} from "antd"
import {useAtom} from "jotai"

import {useRunId} from "@/oss/contexts/RunIdContext"
import usePreviewEvaluations from "@/agenta-oss-common/lib/hooks/usePreviewEvaluations"

import {urlStateAtom} from "../../../state/urlState"

interface AvailableRun {
    id: string
    name: string
    createdAt: string
    status: string
}

const ComparisonModeToggle = () => {
    const [urlState, setUrlState] = useAtom(urlStateAtom)
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [selectedRuns, setSelectedRuns] = useState<string[]>([])

    const currentRunId = useRunId()
    const isComparisonMode = Boolean(urlState.compare && urlState.compare.length > 0)
    const compareRunIds = urlState.compare || []

    console.log("ComparisonModeToggle")
    // Fetch all evaluation runs for comparison
    const {runs: allRuns, swrData} = usePreviewEvaluations()

    // Transform runs for the selector and filter out the current run
    const availableRuns = useMemo(() => {
        if (!allRuns) return []

        return allRuns
            .filter((run) => run.id !== currentRunId)
            .map((run) => ({
                id: run.id,
                name: run.name || `Run ${run.id.slice(0, 8)}`,
                createdAt: new Date(run.createdAt).toLocaleDateString(),
                status: run.status,
            }))
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    }, [allRuns, currentRunId])

    // Get current run info for display
    const currentRun = useMemo(() => {
        if (!allRuns) return null
        return allRuns.find((run) => run.id === currentRunId)
    }, [allRuns, currentRunId])

    // Use ref to track previous compareRunIds to avoid infinite loops
    const prevCompareRunIdsRef = useRef<string[]>([])

    // Sync selectedRuns with URL state when it changes
    useEffect(() => {
        const prevIds = prevCompareRunIdsRef.current
        const currentIds = compareRunIds

        // Check if arrays are different
        const isDifferent =
            prevIds.length !== currentIds.length ||
            prevIds.some((id, index) => id !== currentIds[index])

        if (isDifferent) {
            setSelectedRuns(compareRunIds)
            prevCompareRunIdsRef.current = [...compareRunIds]
        }
    }, [compareRunIds])

    const handleEnableComparison = () => {
        setSelectedRuns(compareRunIds)
        setIsModalOpen(true)
    }

    const handleDisableComparison = () => {
        setUrlState((draft) => {
            draft.compare = undefined
        })
    }

    const handleApplyComparison = () => {
        setUrlState((draft) => {
            draft.compare = selectedRuns.length > 0 ? selectedRuns : undefined
        })
        setIsModalOpen(false)
    }

    const handleRemoveRun = (runIdToRemove: string) => {
        const updatedRuns = compareRunIds.filter((id) => id !== runIdToRemove)
        setUrlState((draft) => {
            draft.compare = updatedRuns.length > 0 ? updatedRuns : undefined
        })
    }

    return (
        <>
            <Space>
                {!isComparisonMode ? (
                    <Button icon={<SwapOutlined />} onClick={handleEnableComparison} type="default">
                        Compare Runs
                    </Button>
                ) : (
                    <Space>
                        <div className="flex items-center gap-2">
                            {/* <span className="text-sm font-medium">Comparing with:</span> */}
                            {compareRunIds.map((runId) => {
                                const run = availableRuns.find((r) => r.id === runId)
                                return (
                                    <Tag
                                        key={runId}
                                        closable
                                        onClose={() => handleRemoveRun(runId)}
                                        color="blue"
                                    >
                                        {run?.name || runId}
                                    </Tag>
                                )
                            })}
                        </div>
                        <Button
                            icon={<PlusOutlined />}
                            onClick={handleEnableComparison}
                            type="dashed"
                        >
                            Add Run
                        </Button>
                        <Button icon={<CloseOutlined />} onClick={handleDisableComparison} danger>
                            Exit Comparison
                        </Button>
                    </Space>
                )}
            </Space>

            <Modal
                title="Select Runs to Compare"
                open={isModalOpen}
                onOk={handleApplyComparison}
                onCancel={() => setIsModalOpen(false)}
                width={600}
                okText="Apply Comparison"
                cancelText="Cancel"
            >
                <div className="space-y-4">
                    <div className="p-3 bg-blue-50 rounded-lg">
                        <div className="flex items-center gap-2">
                            <Tag color="green">Base Run</Tag>
                            <span className="font-medium">
                                {currentRun?.name || `Current Run (${currentRunId?.slice(0, 8)})`}
                            </span>
                        </div>
                        <div className="text-sm text-gray-600 mt-1">
                            This is the base run that other runs will be compared against.
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-2">
                            Select runs to compare with the base run:
                        </label>
                        <Select
                            mode="multiple"
                            placeholder={
                                swrData.isLoading ? "Loading runs..." : "Select runs to compare"
                            }
                            value={selectedRuns}
                            onChange={setSelectedRuns}
                            className="w-full"
                            maxTagCount={3}
                            optionLabelProp="label"
                            loading={swrData.isLoading}
                            disabled={swrData.isLoading || availableRuns.length === 0}
                            notFoundContent={swrData.isLoading ? "Loading..." : "No runs available"}
                        >
                            {availableRuns.map((run) => (
                                <Select.Option key={run.id} value={run.id} label={run.name}>
                                    <div className="flex justify-between items-center">
                                        <span className="font-medium">{run.name}</span>
                                        <div className="flex items-center gap-2">
                                            <Tag
                                                color={
                                                    run.status === "completed" ? "green" : "orange"
                                                }
                                            >
                                                {run.status}
                                            </Tag>
                                            <span className="text-xs text-gray-500">
                                                {run.createdAt}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="text-xs text-gray-400">
                                        {run.id.slice(0, 8)}...
                                    </div>
                                </Select.Option>
                            ))}
                        </Select>
                    </div>

                    {selectedRuns.length > 0 && (
                        <div className="p-3 bg-gray-50 rounded-lg">
                            <div className="text-sm font-medium mb-2">Comparison Preview:</div>
                            <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                    <Tag color="green">Base</Tag>
                                    <span className="text-sm">
                                        {currentRun?.name || `Current Run`}
                                    </span>
                                </div>
                                {selectedRuns.map((runId) => {
                                    const run = availableRuns.find(
                                        (r: AvailableRun) => r.id === runId,
                                    )
                                    return (
                                        <div key={runId} className="flex items-center gap-2">
                                            <Tag color="blue">Compare</Tag>
                                            <span className="text-sm">{run?.name}</span>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    )}

                    <div className="text-xs text-gray-500">
                        <Tooltip title="Comparison mode shows metrics side-by-side for easy performance analysis">
                            💡 Tip: Use comparison mode to analyze performance differences between
                            runs
                        </Tooltip>
                    </div>
                </div>
            </Modal>
        </>
    )
}

export default memo(ComparisonModeToggle)
