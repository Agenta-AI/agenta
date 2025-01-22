import {Tag, Space} from "antd"
import {Timer, PlusCircle} from "@phosphor-icons/react"
import ResultTag from "@/components/ResultTag/ResultTag"
import {GenerationResultUtilsProps} from "./types"
import clsx from "clsx"
import {formatCurrency, formatLatency, formatTokenUsage} from "@/lib/helpers/formatters"
import StatusRenderer from "@/components/pages/observability/components/StatusRenderer"
import {NodeStatusDTO} from "@/services/observability/types"
import TraceDrawerButton from "../../../Drawers/TraceDrawer"

const GenerationResultUtils: React.FC<GenerationResultUtilsProps> = ({className, result}) => {
    const metric = result?.response?.tree?.nodes?.[0].metrics?.acc
    const status = result?.response?.tree.nodes[0].status as NodeStatusDTO
    const durations = metric?.duration?.total
    const tokens = metric?.tokens?.total
    const costs = metric?.costs?.total
    const prompts = metric?.tokens.prompt
    const completions = metric?.tokens.completion

    return (
        <div className={clsx("flex items-center gap-1", className)}>
            <TraceDrawerButton result={result} size="small" className="!mr-1" type="default" />

            {/* <StatusRenderer status={status} /> */}

            <Tag color="default" bordered={false} className="flex items-center gap-1">
                <Timer size={14} /> {formatLatency(durations ? durations / 1000 : null)}
            </Tag>

            <ResultTag
                color="default"
                bordered={false}
                value1={
                    <div className="flex items-center gap-1">
                        <PlusCircle size={14} /> {formatTokenUsage(tokens)} /{" "}
                        {formatCurrency(costs)}
                    </div>
                }
                popoverContent={
                    <Space direction="vertical">
                        <Space>
                            <div>{formatTokenUsage(prompts)}</div>
                            <div>Prompt tokens</div>
                        </Space>
                        <Space>
                            <div>{formatTokenUsage(completions)}</div>
                            <div>Completion tokens</div>
                        </Space>
                    </Space>
                }
            />
        </div>
    )
}

export default GenerationResultUtils
