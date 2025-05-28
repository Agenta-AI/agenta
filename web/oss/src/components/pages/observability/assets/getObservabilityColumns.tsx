import {Space, Tooltip, Typography} from "antd"
import {ColumnsType} from "antd/es/table"

import ResultTag from "@/oss/components/ResultTag/ResultTag"
import TruncatedTooltipTag from "@/oss/components/TruncatedTooltipTag"
import LabelValuePill from "@/oss/components/ui/LabelValuePill"
import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"
import {formatCurrency, formatLatency, formatTokenUsage} from "@/oss/lib/helpers/formatters"
import {getStringOrJson} from "@/oss/lib/helpers/utils"
import {AnnotationDto} from "@/oss/lib/hooks/useAnnotations/types"

import {nodeTypeStyles} from "../components/AvatarTreeContent"
import StatusRenderer from "../components/StatusRenderer"
import {TracesWithAnnotations} from "../ObservabilityDashboard"

interface ObservabilityColumnsProps {
    annotations: AnnotationDto[]
}

export const getObservabilityColumns = ({annotations}: ObservabilityColumnsProps) => {
    const columns: ColumnsType<TracesWithAnnotations> = [
        {
            title: "ID",
            dataIndex: ["node", "id"],
            key: "key",
            width: 200,
            onHeaderCell: () => ({
                style: {minWidth: 200},
            }),
            fixed: "left",
            render: (_, record) => {
                return <ResultTag value1={`# ${record.node.id.split("-")[0]}`} />
            },
        },
        {
            title: "Name",
            dataIndex: ["node", "name"],
            key: "name",
            ellipsis: true,
            width: 200,
            onHeaderCell: () => ({
                style: {minWidth: 200},
            }),
            fixed: "left",
            render: (_, record) => {
                const {icon: Icon} = nodeTypeStyles[record.node.type ?? "default"]

                return (
                    <Space align="center" size={4}>
                        <div className="grid place-items-center">
                            <Icon size={16} />
                        </div>
                        <Typography>
                            {record.node.name.length >= 15 ? (
                                <Tooltip title={record.node.name} placement="bottom">
                                    {record.node.name.slice(0, 15)}...
                                </Tooltip>
                            ) : (
                                record.node.name
                            )}
                        </Typography>
                    </Space>
                )
            },
        },
        {
            title: "Span type",
            key: "span_type",
            dataIndex: ["node", "type"],
            width: 200,
            onHeaderCell: () => ({
                style: {minWidth: 200},
            }),
            render: (_, record) => {
                return <div>{record.node.type}</div>
            },
        },
        {
            title: "Inputs",
            key: "inputs",
            width: 400,
            render: (_, record) => {
                return (
                    <TruncatedTooltipTag
                        children={getStringOrJson(record?.data?.inputs)}
                        placement="bottom"
                    />
                )
            },
        },
        {
            title: "Outputs",
            key: "outputs",
            width: 400,
            render: (_, record) => {
                return (
                    <TruncatedTooltipTag
                        children={getStringOrJson(record?.data?.outputs)}
                        placement="bottom"
                    />
                )
            },
        },
        {
            title: "Evaluators",
            key: "evaluators",
            align: "start",
            children: Array.from(
                new Set(annotations.map((a) => a.references?.evaluator?.slug).filter(Boolean)),
            ).map((evaluatorSlug) => ({
                title: "",
                key: evaluatorSlug,
                onHeaderCell: () => ({
                    style: {display: "none"},
                }),
                render: (_, record) => {
                    const metrics = record.aggregatedEvaluatorMetrics?.[evaluatorSlug || ""]
                    if (!metrics) {
                        return <span className="text-gray-500">–</span>
                    }

                    return (
                        <div className="flex flex-col gap-[6px]">
                            <div className="flex items-center justify-between">
                                <Typography.Text className="text-[10px]">
                                    {evaluatorSlug}
                                </Typography.Text>

                                <Typography.Text className="text-[10px]" type="secondary">
                                    {Object.keys(metrics).length}{" "}
                                    {Object.keys(metrics).length === 1 ? "metric" : "metrics"}
                                </Typography.Text>
                            </div>

                            <div className="flex items-center gap-2 max-w-[450px] overflow-x-auto [&::-webkit-scrollbar]:!w-0">
                                {Object.entries(metrics).map(([metricName, rawData]) => {
                                    const data = rawData as {average?: number}

                                    return (
                                        <LabelValuePill
                                            key={metricName}
                                            label={metricName}
                                            value={`μ ${data.average}`}
                                            className="!min-w-fit"
                                        />
                                    )
                                })}
                            </div>
                        </div>
                    )
                },
            })),
        },
        {
            title: "Duration",
            key: "duration",
            dataIndex: ["time", "span"],
            width: 80,
            onHeaderCell: () => ({
                style: {minWidth: 80},
            }),
            render: (_, record) => (
                <div>
                    {formatLatency(
                        record?.metrics?.acc?.duration?.total
                            ? record?.metrics?.acc?.duration?.total / 1000
                            : null,
                    )}
                </div>
            ),
        },
        {
            title: "Cost",
            key: "cost",
            dataIndex: ["metrics", "acc", "costs", "total"],
            width: 80,
            onHeaderCell: () => ({
                style: {minWidth: 80},
            }),
            render: (_, record) => <div>{formatCurrency(record.metrics?.acc?.costs?.total)}</div>,
        },
        {
            title: "Usage",
            key: "usage",
            dataIndex: ["metrics", "acc", "tokens", "total"],
            width: 80,
            onHeaderCell: () => ({
                style: {minWidth: 80},
            }),
            render: (_, record) => (
                <div>{formatTokenUsage(record.metrics?.acc?.tokens?.total)}</div>
            ),
        },
        {
            title: "Timestamp",
            key: "timestamp",
            dataIndex: ["lifecycle", "created_at"],
            width: 200,
            onHeaderCell: () => ({
                style: {minWidth: 200},
            }),
            render: (_, record) => {
                return (
                    <div>
                        {formatDay({
                            date: record.lifecycle?.created_at,
                            outputFormat: "HH:mm:ss DD MMM YYYY",
                        })}
                    </div>
                )
            },
        },
        {
            title: "Status",
            key: "status",
            dataIndex: ["status", "code"],
            width: 160,
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (_, record) => StatusRenderer({status: record.status, showMore: true}),
        },
    ]

    return columns
}
