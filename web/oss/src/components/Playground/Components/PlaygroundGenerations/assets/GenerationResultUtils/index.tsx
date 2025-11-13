import {memo, useMemo} from "react"

import {Timer, PlusCircle} from "@phosphor-icons/react"
import {Tag, Space} from "antd"
import clsx from "clsx"

import StatusRenderer from "@/oss/components/pages/observability/components/StatusRenderer"
import ResultTag from "@/oss/components/ResultTag/ResultTag"
import {formatCurrency, formatLatency, formatTokenUsage} from "@/oss/lib/helpers/formatters"
import {StatusCode} from "@/oss/services/tracing/types"

import TraceDrawerButton from "../../../Drawers/TraceDrawer"

import {GenerationResultUtilsProps} from "./types"

const GenerationResultUtils: React.FC<GenerationResultUtilsProps> = ({
    className,
    showStatus = true,
    result,
    tourTargetId,
    traceButtonTourId,
}) => {
    const tree = result?.response?.tree
    const node = tree?.nodes?.[0]
    const metricAcc = node?.metrics?.acc
    const metricUnit = node?.metrics?.unit
    const metric = metricAcc || metricUnit
    const status = result?.error ? StatusCode.STATUS_CODE_ERROR : (node?.status as StatusCode)
    const durations = metric?.duration?.total
    const tokens = metric?.tokens?.total
    const costs = metric?.costs?.total
    const prompts = metric?.tokens?.prompt
    const completions = metric?.tokens?.completion

    const formattedPrompts = useMemo(() => formatTokenUsage(prompts), [prompts])
    const formattedCompletions = useMemo(() => formatTokenUsage(completions), [completions])
    const formattedTokens = useMemo(() => formatTokenUsage(tokens), [tokens])
    const formattedLatency = useMemo(
        () => formatLatency(durations ? durations / 1000 : null),
        [durations],
    )
    const formattedCosts = useMemo(() => formatCurrency(costs), [costs])

    return (
        <div
            className={clsx("flex items-center gap-1", className)}
            id={tourTargetId}
            data-tour-target={tourTargetId ? "true" : undefined}
        >
            <TraceDrawerButton
                result={result}
                size="small"
                type="default"
                id={traceButtonTourId}
                data-tour-target={traceButtonTourId ? "true" : undefined}
            />

            {showStatus && <StatusRenderer status={status} />}

            {durations ? (
                <Tag color="default" bordered={false} className="flex items-center gap-1">
                    <Timer size={14} /> {formattedLatency}
                </Tag>
            ) : null}

            {tokens || costs ? (
                <ResultTag
                    color="default"
                    bordered={false}
                    value1={
                        <div className="flex items-center gap-1 text-nowrap">
                            <PlusCircle size={14} /> {formattedTokens} / {formattedCosts}
                        </div>
                    }
                    popoverContent={
                        <Space direction="vertical">
                            <Space>
                                <div>{formattedPrompts}</div>
                                <div>Prompt tokens</div>
                            </Space>
                            <Space>
                                <div>{formattedCompletions}</div>
                                <div>Completion tokens</div>
                            </Space>
                        </Space>
                    }
                />
            ) : null}
        </div>
    )
}

export default memo(GenerationResultUtils)
