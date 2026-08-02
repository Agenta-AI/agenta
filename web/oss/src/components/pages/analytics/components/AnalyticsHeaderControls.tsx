import {useMemo} from "react"

import {FunnelIcon} from "@phosphor-icons/react"
import {Badge, Button, Popover, Select, Typography} from "antd"
import {useAtom, useAtomValue} from "jotai"

import Sort from "@/oss/components/Filters/Sort"
import {agentsWorkflowsAtom} from "@/oss/components/pages/agents/store"
import {analyticsAgentsFilterAtom, analyticsTimeRangeAtom} from "@/oss/state/analytics/dashboard"

interface AnalyticsHeaderControlsProps {
    disabled?: boolean
}

const AnalyticsHeaderControls = ({disabled}: AnalyticsHeaderControlsProps) => {
    const [timeRange, setTimeRange] = useAtom(analyticsTimeRangeAtom)
    const [agentIds, setAgentIds] = useAtom(analyticsAgentsFilterAtom)
    const agents = useAtomValue(agentsWorkflowsAtom)

    const options = useMemo(
        () => agents.map((a) => ({label: a.name, value: a.workflowId})),
        [agents],
    )

    const filterContent = (
        <div className="flex flex-col gap-2 w-[280px]">
            <Typography.Text className="text-[12px] text-colorTextSecondary">
                Agents
            </Typography.Text>
            <Select
                mode="multiple"
                allowClear
                placeholder="All agents"
                value={agentIds}
                onChange={setAgentIds}
                options={options}
                maxTagCount="responsive"
                className="w-full"
            />
        </div>
    )

    return (
        <div className="flex items-center gap-2">
            <Popover trigger="click" placement="bottomRight" content={filterContent}>
                <Badge count={agentIds.length} size="small">
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
