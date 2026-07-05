import {memo, useMemo} from "react"

import {CopyTooltip} from "@agenta/ui/copy-tooltip"
import {Tag} from "antd"

import ScenarioNavigator from "./ScenarioNavigator"
import type {ScenarioHeaderProps} from "./types"
import {getScenarioStatusColor} from "./utils"

const ScenarioHeader = ({runId, scenarioId, status, onScenarioChange}: ScenarioHeaderProps) => {
    const statusColor = useMemo(() => getScenarioStatusColor(status), [status])

    return (
        <div className="w-full p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <ScenarioNavigator
                    runId={runId}
                    scenarioId={scenarioId}
                    onChange={onScenarioChange}
                    showScenarioIdTag={false}
                />
                <div className="flex items-center gap-2 text-xs">
                    {status ? (
                        <Tag color={statusColor} className="m-0">
                            {String(status)}
                        </Tag>
                    ) : null}
                    <CopyTooltip copyText={scenarioId} title="Copy scenario id">
                        <span className="text-xs text-muted-foreground cursor-copy">
                            {scenarioId}
                        </span>
                    </CopyTooltip>
                </div>
            </div>
        </div>
    )
}

export default memo(ScenarioHeader)
