import {Flex, Space, Typography} from "antd"
import {useAtomValue} from "jotai"
import {PlusCircle, Timer} from "lucide-react"

import {statusMapper} from "@/oss/components/pages/observability/components/AvatarTreeContent"
import StatusRenderer from "@/oss/components/pages/observability/components/StatusRenderer"
import ResultTag from "@/oss/components/ResultTag/ResultTag"
import {TraceSpanNode} from "@/oss/services/tracing/types"
import {
    formattedSpanCompletionTokensAtomFamily,
    formattedSpanCostAtomFamily,
    formattedSpanLatencyAtomFamily,
    formattedSpanPromptTokensAtomFamily,
    formattedSpanTokensAtomFamily,
    spanEndTimeAtomFamily,
    spanStartTimeAtomFamily,
} from "@/oss/state/newObservability"

const titleClass = "text-sm leading-[1.5714285714285714] font-medium"
const resultTagClass = "flex items-center font-mono gap-1"
const tokenContainerClass =
    "[&>div:nth-of-type(1)]:leading-[1.5714285714285714] [&>div:nth-of-type(1)]:font-medium [&>div:nth-of-type(2)]:leading-[1.5714285714285714] [&>div:nth-of-type(2)]:font-normal"

const TraceDetails = ({activeTrace}: {activeTrace: TraceSpanNode}) => {
    const {icon, bgColor, color} = statusMapper(activeTrace?.span_type)
    const formattedTokens = useAtomValue(formattedSpanTokensAtomFamily(activeTrace))
    const formattedCost = useAtomValue(formattedSpanCostAtomFamily(activeTrace))
    const formattedLatency = useAtomValue(formattedSpanLatencyAtomFamily(activeTrace))
    const formattedPromptTokens = useAtomValue(formattedSpanPromptTokensAtomFamily(activeTrace))
    const formattedCompletionTokens = useAtomValue(
        formattedSpanCompletionTokensAtomFamily(activeTrace),
    )
    const traceStartTime = useAtomValue(spanStartTimeAtomFamily(activeTrace))
    const traceEndTime = useAtomValue(spanEndTimeAtomFamily(activeTrace))
    return (
        <Flex vertical gap={12}>
            <Space orientation="vertical" size={4}>
                <Typography.Text className={titleClass}>Type</Typography.Text>

                <ResultTag
                    style={{
                        backgroundColor: bgColor,
                        color: color,
                    }}
                    className="font-mono"
                    bordered={false}
                    value1={
                        <>
                            {icon} {activeTrace?.span_type}
                        </>
                    }
                />
            </Space>

            <Space orientation="vertical" size={4}>
                <Typography.Text className={titleClass}>Status</Typography.Text>
                <StatusRenderer
                    status={activeTrace?.status_code}
                    message={activeTrace?.status_message}
                    tagProps={{bordered: false}}
                />
            </Space>

            <Space orientation="vertical" size={4}>
                <Typography.Text className={titleClass}>Latency</Typography.Text>
                <ResultTag
                    bordered={false}
                    className="bg-[var(--ag-c-0517290F)]"
                    value1={
                        <div className={resultTagClass}>
                            <Timer size={14} /> {formattedLatency}
                        </div>
                    }
                />
            </Space>

            <Space orientation="vertical" size={4}>
                <Typography.Text className={titleClass}>Timestamp</Typography.Text>

                <ResultTag
                    value1={<div className={resultTagClass}>Start - {traceStartTime}</div>}
                    bordered={false}
                    className="bg-[var(--ag-c-0517290F)]"
                />
                <ResultTag
                    bordered={false}
                    className="bg-[var(--ag-c-0517290F)]"
                    value1={
                        <div className={resultTagClass}>
                            End {"  "}- {traceEndTime}
                        </div>
                    }
                />
            </Space>

            <Space orientation="vertical" size={4}>
                <Typography.Text className={titleClass}>Tokens & Cost</Typography.Text>
                <ResultTag
                    bordered={false}
                    className="bg-[var(--ag-c-0517290F)]"
                    value1={
                        <div className={resultTagClass}>
                            <PlusCircle size={14} />
                            {formattedTokens} / {formattedCost}
                        </div>
                    }
                    popoverContent={
                        <Space orientation="vertical">
                            <Space className={tokenContainerClass}>
                                <div>{formattedPromptTokens}</div>
                                <div>Prompt tokens</div>
                            </Space>
                            <Space className={tokenContainerClass}>
                                <div>{formattedCompletionTokens}</div>
                                <div>Completion tokens</div>
                            </Space>
                        </Space>
                    }
                />
            </Space>
        </Flex>
    )
}

export default TraceDetails
