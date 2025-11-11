import React from "react"

import {Flex, Space, Typography} from "antd"
import dayjs from "dayjs"
import {PlusCircle, Timer} from "lucide-react"

import ResultTag from "@/oss/components/ResultTag/ResultTag"
import {formatCurrency, formatLatency, formatTokenUsage} from "@/oss/lib/helpers/formatters"
import {TracesWithAnnotations} from "@/oss/services/observability/types"

import {statusMapper} from "../../../components/AvatarTreeContent"
import StatusRenderer from "../../../components/StatusRenderer"

import {useStyles} from "./assets/styles"

const TraceDetails = ({activeTrace}: {activeTrace: TracesWithAnnotations}) => {
    const classes = useStyles()
    const {icon, bgColor, color} = statusMapper(activeTrace?.node?.type)

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
                            {icon} {activeTrace?.node?.type}
                        </>
                    }
                />
            </Space>

            <Space direction="vertical" size={4}>
                <Typography.Text className={classes.title}>Status</Typography.Text>
                <StatusRenderer status={activeTrace?.status} />
            </Space>

            <Space direction="vertical" size={4}>
                <Typography.Text className={classes.title}>Latency</Typography.Text>
                <ResultTag
                    bordered={false}
                    className="bg-[rgba(5,23,41,0.06)]"
                    value1={
                        <div className={classes.resultTag}>
                            <Timer size={14} />{" "}
                            {formatLatency(
                                activeTrace?.metrics?.acc?.duration?.total
                                    ? activeTrace?.metrics?.acc?.duration?.total / 1000
                                    : null,
                            )}
                        </div>
                    }
                />
            </Space>

            <Space direction="vertical" size={4}>
                <Typography.Text className={classes.title}>Timestamp</Typography.Text>

                <ResultTag
                    value1={
                        <div className={classes.resultTag}>
                            Start -{" "}
                            {dayjs(activeTrace?.time?.start)
                                .local()
                                .format("DD/MM/YYYY, hh:mm:ss A")}
                        </div>
                    }
                    bordered={false}
                    className="bg-[rgba(5,23,41,0.06)]"
                />
                <ResultTag
                    bordered={false}
                    className="bg-[rgba(5,23,41,0.06)]"
                    value1={
                        <div className={classes.resultTag}>
                            End {"  "}-{" "}
                            {dayjs(activeTrace?.time?.end).local().format("DD/MM/YYYY, hh:mm:ss A")}
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
                            {formatTokenUsage(
                                activeTrace?.metrics?.unit?.tokens?.total ||
                                    activeTrace?.metrics?.acc?.tokens?.total,
                            )}{" "}
                            /{" "}
                            {formatCurrency(
                                activeTrace?.metrics?.unit?.costs?.total ||
                                    activeTrace?.metrics?.acc?.costs?.total,
                            )}
                        </div>
                    }
                    popoverContent={
                        <Space direction="vertical">
                            <Space className={classes.tokenContainer}>
                                <div>
                                    {formatTokenUsage(
                                        activeTrace?.metrics?.unit?.tokens?.prompt ||
                                            activeTrace?.metrics?.acc?.tokens?.prompt,
                                    )}
                                </div>
                                <div>Prompt tokens</div>
                            </Space>
                            <Space className={classes.tokenContainer}>
                                <div>
                                    {formatTokenUsage(
                                        activeTrace?.metrics?.unit?.tokens?.completion ||
                                            activeTrace?.metrics?.acc?.tokens?.completion,
                                    )}
                                </div>
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
