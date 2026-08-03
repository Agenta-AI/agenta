import {useMemo} from "react"

import {FunnelIcon} from "@phosphor-icons/react"
import {Badge, Button, Popover, Select, Typography} from "antd"
import {useAtom, useAtomValue} from "jotai"

import Sort from "@/oss/components/Filters/Sort"
import {agentsWorkflowsAtom} from "@/oss/components/pages/agents/store"
import {
    analyticsAgentsFilterAtom,
    analyticsHarnessFilterAtom,
    analyticsModelsFilterAtom,
    analyticsTimeRangeAtom,
    useAnalyticsFilterOptions,
} from "@/oss/state/analytics/dashboard"

interface AnalyticsHeaderControlsProps {
    disabled?: boolean
}

const AnalyticsHeaderControls = ({disabled}: AnalyticsHeaderControlsProps) => {
    const [timeRange, setTimeRange] = useAtom(analyticsTimeRangeAtom)
    const [agentIds, setAgentIds] = useAtom(analyticsAgentsFilterAtom)
    const [harnessKinds, setHarnessKinds] = useAtom(analyticsHarnessFilterAtom)
    const [models, setModels] = useAtom(analyticsModelsFilterAtom)
    const agents = useAtomValue(agentsWorkflowsAtom)
    const filterOptions = useAnalyticsFilterOptions()

    const agentOptions = useMemo(
        () => agents.map((a) => ({label: a.name, value: a.workflowId})),
        [agents],
    )
    // Options come from a breakdown not narrowed by the harness/model filters, so
    // selecting one value never removes the others.
    const harnessOptions = useMemo(
        () => (filterOptions?.harness ?? []).map((h) => ({label: h.label, value: h.key})),
        [filterOptions],
    )
    const modelOptions = useMemo(
        () => (filterOptions?.model ?? []).map((m) => ({label: m.label, value: m.key})),
        [filterOptions],
    )

    const activeCount = agentIds.length + harnessKinds.length + models.length

    const filterContent = (
        <div className="flex flex-col gap-3 w-[280px]">
            <div className="flex flex-col gap-1">
                <Typography.Text className="text-[12px] text-colorTextSecondary">
                    Agents
                </Typography.Text>
                <Select
                    mode="multiple"
                    allowClear
                    placeholder="All agents"
                    value={agentIds}
                    onChange={setAgentIds}
                    options={agentOptions}
                    maxTagCount="responsive"
                    className="w-full"
                />
            </div>
            <div className="flex flex-col gap-1">
                <Typography.Text className="text-[12px] text-colorTextSecondary">
                    Harness
                </Typography.Text>
                <Select
                    mode="multiple"
                    allowClear
                    placeholder="All harnesses"
                    value={harnessKinds}
                    onChange={setHarnessKinds}
                    options={harnessOptions}
                    maxTagCount="responsive"
                    className="w-full"
                />
            </div>
            <div className="flex flex-col gap-1">
                <Typography.Text className="text-[12px] text-colorTextSecondary">
                    Configured model
                </Typography.Text>
                <Select
                    mode="multiple"
                    allowClear
                    placeholder="All models"
                    value={models}
                    onChange={setModels}
                    options={modelOptions}
                    maxTagCount="responsive"
                    className="w-full"
                />
            </div>
        </div>
    )

    return (
        <div className="flex items-center gap-2">
            <Popover trigger="click" placement="bottomRight" content={filterContent}>
                <Badge count={activeCount} size="small">
                    <Button icon={<FunnelIcon size={14} />} disabled={disabled}>
                        Filters
                    </Button>
                </Badge>
            </Popover>
            <Sort
                type="default"
                disabled={disabled}
                onSortApply={setTimeRange}
                defaultSortValue={timeRange.label || "7 days"}
                exclude={["all time"]}
                ariaLabel="Analytics date range"
            />
        </div>
    )
}

export default AnalyticsHeaderControls
