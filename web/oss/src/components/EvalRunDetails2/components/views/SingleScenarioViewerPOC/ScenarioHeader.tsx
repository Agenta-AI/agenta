import {memo, useMemo} from "react"

import {Tag, Typography} from "antd"

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
                    <Typography.Text
                        type="secondary"
                        copyable={{text: scenarioId}}
                        className="text-xs"
                    >
                        {scenarioId}
                    </Typography.Text>
                </div>
            </div>
        </div>
    )
}

export default memo(ScenarioHeader)
