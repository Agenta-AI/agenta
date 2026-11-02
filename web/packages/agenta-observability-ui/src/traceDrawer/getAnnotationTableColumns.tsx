import {AnnotationDto} from "@agenta/entities/annotation/dto"
import {UserAuthorLabel} from "@agenta/entities/shared/user"
import {setTraceDrawerTraceAtom} from "@agenta/observability/traceDrawer"
import {getStringOrJson} from "@agenta/shared/utils"
import {EnhancedButton} from "@agenta/ui/components/presentational"
import {TreeStructure} from "@phosphor-icons/react"
import {getDefaultStore} from "jotai"

import type {SimpleColumn} from "../primitives/SimpleTable"
import {ValueTag} from "../primitives/ValueTag"

export const getAnnotationTableColumns = (
    reference: string,
    groupAnnotations: AnnotationDto[],
): SimpleColumn<AnnotationDto>[] => {
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
                    <EnhancedButton
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
        {
            title: "Metrics",
            key: `metrics-${reference}`,
            align: "start",
            children: Array.from(
                new Set(
                    groupAnnotations.flatMap((a) =>
                        Object.keys(
                            (a.data?.outputs?.metrics || {}) as Record<string, unknown>,
                        ).concat(
                            Object.keys((a.data?.outputs?.extra || {}) as Record<string, unknown>),
                        ),
                    ),
                ),
            ).map((metricKey) => ({
                title: metricKey,
                key: `metrics-${reference}-${metricKey}`,
                onHeaderCell: () => ({style: {minWidth: 160}}),
                render: (_: unknown, record: AnnotationDto) => {
                    // `outputs` is a deep JSON union in the DTO; read the two buckets by key.
                    const outputs = record.data?.outputs as
                        | Record<string, Record<string, {value?: unknown}> | undefined>
                        | undefined
                    const value = outputs?.metrics?.[metricKey]?.value
                    const extraValue = outputs?.extra?.[metricKey]?.value

                    if (value === undefined && extraValue === undefined) {
                        return <span className="text-gray-500">–</span>
                    }

                    return value !== undefined ? (
                        typeof value === "boolean" ? (
                            <ValueTag value={getStringOrJson(value)} className="w-fit" />
                        ) : (
                            <span>{getStringOrJson(value)}</span>
                        )
                    ) : extraValue !== undefined ? (
                        Array.isArray(extraValue) ? (
                            <div className="flex items-center gap-2 max-w-[450px] overflow-x-auto [&::-webkit-scrollbar]:!w-0">
                                {extraValue.map((item, index) => (
                                    <ValueTag
                                        key={index}
                                        value={getStringOrJson(item)}
                                        className="w-fit"
                                    />
                                ))}
                            </div>
                        ) : (
                            <ValueTag value={getStringOrJson(extraValue)} className="w-fit" />
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
                        <UserAuthorLabel name={record.createdBy || ""} showAvatar />
                    </div>
                )
            },
        },
    ]
}
