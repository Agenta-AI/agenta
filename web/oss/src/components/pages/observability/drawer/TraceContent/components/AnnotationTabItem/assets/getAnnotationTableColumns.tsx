import {Typography} from "antd"
import {ColumnsType} from "antd/es/table"

import UserAvatarTag from "@/oss/components/ui/UserAvatarTag"
import {getStringOrJson} from "@/oss/lib/helpers/utils"
import {AnnotationDto} from "@/oss/lib/hooks/useAnnotations/types"

export const getAnnotationTableColumns = (
    reference: string,
    groupAnnotations: AnnotationDto[],
): ColumnsType<AnnotationDto> => {
    return [
        {
            title: "Evaluator",
            key: "evaluator",
            width: 280,
            onHeaderCell: () => ({
                style: {minWidth: 280},
            }),
            render: (_, record) => {
                return <Typography.Text>{record?.references?.evaluator?.slug}</Typography.Text>
            },
        },
        {
            title: "Metrics",
            key: `metrics-${reference}`,
            align: "start",
            children: Array.from(
                new Set(
                    groupAnnotations.flatMap((a) => Object.keys(a.data?.outputs?.metrics || {})),
                ),
            ).map((metricKey) => ({
                title: metricKey,
                key: `metrics-${reference}-${metricKey}`,
                onHeaderCell: () => ({style: {minWidth: 160}}),
                render: (_: any, record: any) => {
                    if (!record.data?.outputs?.metrics) {
                        return <span className="text-gray-500">–</span>
                    }

                    const value = record.data.outputs.metrics[metricKey]
                    return value !== undefined ? (
                        <span>{getStringOrJson(value)}</span>
                    ) : (
                        <span className="text-gray-500">–</span>
                    )
                },
            })),
        },
        {
            title: "Type",
            key: "type",
            width: 200,
            onHeaderCell: () => ({
                style: {minWidth: 200},
            }),
            render: (_, record) => {
                return <div>{record.kind}</div>
            },
        },
        {
            title: "Source",
            key: "source",
            width: 144,
            onHeaderCell: () => ({
                style: {minWidth: 144},
            }),
            render: (_, record) => {
                return <div>{record.source}</div>
            },
        },
        {
            title: "Date created",
            key: "date_created",
            width: 200,
            onHeaderCell: () => ({
                style: {minWidth: 200},
            }),
            render: (_, record) => {
                return <div>{record.created_at}</div>
            },
        },
        {
            title: "Created by",
            key: "created_by",
            width: 200,
            onHeaderCell: () => ({
                style: {minWidth: 200},
            }),
            render: (_, record) => {
                return (
                    <div className="flex items-center justify-start">
                        <UserAvatarTag modifiedBy={record.created_by_id || ""} />
                    </div>
                )
            },
        },
    ]
}
