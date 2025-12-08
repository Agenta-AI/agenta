import {ColumnsType} from "antd/es/table"

import CustomAntdTag from "@/oss/components/ui/CustomAntdTag"
import UserAvatarTag from "@/oss/components/ui/UserAvatarTag"
import {getStringOrJson} from "@/oss/lib/helpers/utils"
import {AnnotationDto} from "@/oss/lib/hooks/useAnnotations/types"
import {TreeStructure} from "@phosphor-icons/react"
import {Button} from "antd"
import {getDefaultStore} from "jotai"
import {setTraceDrawerTraceAtom} from "@/oss/components/Playground/Components/Drawers/TraceDrawer/store/traceDrawerStore"
import {Table} from "antd"

export const getAnnotationTableColumns = (
    reference: string,
    groupAnnotations: AnnotationDto[],
): ColumnsType<AnnotationDto> => {
    return [
        {
            title: null,
            key: "trace",
            width: 60,
            fixed: "left",
            onHeaderCell: () => ({
                style: {minWidth: 60},
            }),
            render: (_, record) => {
                return (
                    <Button
                        icon={
                            <TreeStructure
                                size={14}
                                onClick={() => {
                                    const store = getDefaultStore()
                                    store.set(setTraceDrawerTraceAtom, {
                                        traceId: record.trace_id,
                                        activeSpanId: record.span_id,
                                        source: "linked",
                                    })
                                }}
                            />
                        }
                        size="small"
                    />
                )
            },
        },
        Table.EXPAND_COLUMN,
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
                        <UserAvatarTag modifiedBy={record.createdBy || ""} />
                    </div>
                )
            },
        },
        {
            title: "Metrics",
            key: `metrics-${reference}`,
            align: "start",
            children: Array.from(
                new Set(
                    groupAnnotations.flatMap((a) =>
                        Object.keys((a.data?.outputs?.metrics || {}) as Record<string, any>).concat(
                            Object.keys((a.data?.outputs?.extra || {}) as Record<string, any>),
                        ),
                    ),
                ),
            ).map((metricKey) => ({
                title: metricKey,
                key: `metrics-${reference}-${metricKey}`,
                onHeaderCell: () => ({style: {minWidth: 160}}),
                render: (_: any, record: any) => {
                    if (!record.data?.outputs?.metrics || !record.data?.outputs?.extra) {
                        return <span className="text-gray-500">–</span>
                    }

                    const value = record.data.outputs.metrics[metricKey]?.value
                    const extraValue = record.data.outputs.extra[metricKey]?.value

                    return value !== undefined ? (
                        typeof value === "boolean" ? (
                            <CustomAntdTag
                                value={getStringOrJson(value)}
                                className="w-fit"
                                bordered={false}
                            />
                        ) : (
                            <span>{getStringOrJson(value)}</span>
                        )
                    ) : extraValue !== undefined ? (
                        Array.isArray(extraValue) ? (
                            <div className="flex items-center gap-2 max-w-[450px] overflow-x-auto [&::-webkit-scrollbar]:!w-0">
                                {extraValue.map((item, index) => (
                                    <CustomAntdTag
                                        key={index}
                                        value={getStringOrJson(item)}
                                        className="w-fit"
                                        bordered={false}
                                    />
                                ))}
                            </div>
                        ) : (
                            <CustomAntdTag
                                value={getStringOrJson(extraValue)}
                                className="w-fit"
                                bordered={false}
                            />
                        )
                    ) : (
                        <span className="text-gray-500">–</span>
                    )
                },
            })),
        },
        {
            title: "Kind",
            key: "kind",
            width: 144,
            onHeaderCell: () => ({
                style: {minWidth: 144},
            }),
            render: (_, record) => {
                return <div>{record.kind}</div>
            },
        },
        {
            title: "Channel",
            key: "channel",
            width: 144,
            onHeaderCell: () => ({
                style: {minWidth: 144},
            }),
            render: (_, record) => {
                return <div>{record.channel}</div>
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
                return <div>{record.createdAt}</div>
            },
        },
    ]
}
