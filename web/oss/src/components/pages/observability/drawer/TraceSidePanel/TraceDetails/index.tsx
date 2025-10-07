import React from "react"

import {Flex, Space, Typography} from "antd"
import {useAtomValue} from "jotai"
import {PlusCircle, Timer} from "lucide-react"

import ResultTag from "@/oss/components/ResultTag/ResultTag"
import {formatCurrency, formatLatency, formatTokenUsage} from "@/oss/lib/helpers/formatters"
import {TraceSpanNode} from "@/oss/services/tracing/types"
import {
    formattedSpanLatencyAtomFamily,
    formattedSpanTokensAtomFamily,
    formattedSpanCostAtomFamily,
    formattedSpanPromptTokensAtomFamily,
    formattedSpanCompletionTokensAtomFamily,
    spanStartTimeAtomFamily,
    spanEndTimeAtomFamily,
} from "@/oss/state/newObservability"

import {statusMapper} from "../../../components/AvatarTreeContent"
import StatusRenderer from "../../../components/StatusRenderer"

import {useStyles} from "./assets/styles"

const TraceDetails = ({activeTrace}: {activeTrace: TraceSpanNode}) => {
    const classes = useStyles()
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
            {/* TODO: Display variant */}
            {/* <Space direction="vertical" size={4}>
                <Typography.Text className={classes.title}>Variant</Typography.Text>
            </Space> */}

            <Space direction="vertical" size={4}>
                <Typography.Text className={classes.title}>Type</Typography.Text>

                <ResultTag
                    style={{
                        backgroundColor: bgColor,
                        border: `1px solid ${color}`,
                        color: color,
                    }}
                    className="font-mono"
                    bordered
                    value1={
                        <>
                            {icon} {activeTrace?.span_type}
                        </>
                    }
                />
            </Space>

            <Space direction="vertical" size={4}>
                <Typography.Text className={classes.title}>Status</Typography.Text>
                <StatusRenderer
                    status={activeTrace?.status_code}
                    message={activeTrace?.status_message}
                />{" "}
            </Space>

            <Space direction="vertical" size={4}>
                <Typography.Text className={classes.title}>Latency</Typography.Text>
                <ResultTag
                    bordered={false}
                    className="bg-[rgba(5,23,41,0.06)]"
                    value1={
                        <div className={classes.resultTag}>
                            <Timer size={14} /> {formattedLatency}
                        </div>
                    }
                />
            </Space>

            <Space direction="vertical" size={4}>
                <Typography.Text className={classes.title}>Timestamp</Typography.Text>

                <ResultTag
                    value1={<div className={classes.resultTag}>Start - {traceStartTime}</div>}
                    bordered={false}
                    className="bg-[rgba(5,23,41,0.06)]"
                />
                <ResultTag
                    bordered={false}
                    className="bg-[rgba(5,23,41,0.06)]"
                    value1={
                        <div className={classes.resultTag}>
                            End {"  "}- {traceEndTime}
                        </div>
                    }
                />
            </Space>

            <Space direction="vertical" size={4}>
                <Typography.Text className={classes.title}>Tokens & Cost</Typography.Text>
                <ResultTag
                    className="bg-[rgba(5,23,41,0.06)]"
                    value1={
                        <div className={classes.resultTag}>
                            <PlusCircle size={14} />
                            {formattedTokens} / {formattedCost}
                        </div>
                    }
                    popoverContent={
                        <Space direction="vertical">
                            <Space className={classes.tokenContainer}>
                                <div>{formattedPromptTokens}</div>
                                <div>Prompt tokens</div>
                            </Space>
                            <Space className={classes.tokenContainer}>
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
