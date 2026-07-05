import {useMemo} from "react"

import {evaluatorsListDataAtom, resolveOutputSchemaProperties} from "@agenta/entities/workflow"
import {Badge} from "@agenta/primitive-ui/components/badge"
import {Button} from "@agenta/primitive-ui/components/button"
import {MinusOutlined, PlusOutlined} from "@ant-design/icons"
import {ChatText} from "@phosphor-icons/react"
import {Flex, Space, Table} from "antd"
import type {TableProps} from "antd/es/table"
import clsx from "clsx"
import {useAtomValue} from "jotai"
import {createUseStyles} from "react-jss"

import {
    NUMERIC_METRIC_TYPES,
    USEABLE_METRIC_TYPES,
} from "@/oss/components/SharedDrawers/AnnotateDrawer/assets/constants"
import EvaluatorDetailsPopover from "@/oss/components/SharedDrawers/TraceDrawer/components/EvaluatorDetailsPopover"
import {AnnotationDto} from "@/oss/lib/hooks/useAnnotations/types"
import {JSSTheme} from "@/oss/lib/Types"

import NoTraceAnnotations from "../../../TraceSidePanel/TraceAnnotations/components/NoTraceAnnotations"

import {getAnnotationTableColumns} from "./assets/getAnnotationTableColumns"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    expandableTable: {
        "& .ant-table-cell": {
            backgroundColor: theme.colorFillTertiary,
        },
    },
    table: {
        "& .ant-table-expanded-row > .ant-table-cell": {
            padding: 0,
        },
    },
}))

const AnnotationTabItem = ({annotations}: {annotations: AnnotationDto[]}) => {
    const classes = useStyles()
    const evaluators = useAtomValue(evaluatorsListDataAtom)

    // Last minute changes to display multiselect values in the table. This is not the best way to do it but it works for now.
    const mergedAnnWithEvaluator = useMemo(() => {
        return annotations.map((ann) => {
            const outputs = (ann.data?.outputs as Record<string, any>) || {}
            const allAnnMetrics = {...outputs.metrics, ...outputs.notes, ...outputs.extra}
            const evaluator = evaluators.find((e) => e.slug === ann.references?.evaluator?.slug)

            const evalMetricsSchema = resolveOutputSchemaProperties(evaluator?.data) ?? {}

            const grouped = Object.entries(allAnnMetrics).reduce(
                (acc, [key, value]) => {
                    const schema = evalMetricsSchema[key]
                    let type: string
                    const metricValue = value

                    if (schema?.anyOf) {
                        type = "class"
                    } else if (schema?.type === "array") {
                        type = "array"
                    } else if (schema?.type && USEABLE_METRIC_TYPES.includes(schema.type)) {
                        type = schema.type
                    } else if (typeof metricValue === "string") {
                        // Preserve free-text comments even if evaluator schema is missing this key.
                        type = "string"
                    } else if (typeof metricValue === "number") {
                        type = "number"
                    } else if (typeof metricValue === "boolean") {
                        type = "boolean"
                    } else if (Array.isArray(metricValue)) {
                        type = "array"
                    } else {
                        type = "class"
                    }

                    const metricObj = {value: metricValue, type}

                    if (NUMERIC_METRIC_TYPES.includes(type) || type === "boolean") {
                        acc.metrics[key] = metricObj
                    } else if (type === "string") {
                        acc.notes[key] = metricObj
                    } else {
                        acc.extra[key] = metricObj
                    }

                    return acc
                },
                {metrics: {}, notes: {}, extra: {}} as Record<string, Record<string, any>>,
            )

            return {
                ...ann,
                data: {
                    ...ann.data,
                    outputs: grouped,
                },
                evaluator,
            }
        })
    }, [annotations, evaluators])

    const groupedByReference = mergedAnnWithEvaluator.reduce(
        (acc, item) => {
            const slug = item.references?.evaluator?.slug || "unknown-slug"
            const origin = item.origin || "unknown-type"
            const key = `${slug}::${origin}`

            if (!acc[key]) {
                acc[key] = []
            }
            acc[key].push({...item})
            return acc
        },
        {} as Record<string, AnnotationDto[]>,
    )

    const expandable: TableProps<AnnotationDto>["expandable"] = {
        expandedRowRender: (record) => (
            <div>
                <Table
                    columns={[
                        {
                            title: "User",
                            key: "user",
                            dataIndex: "user",
                            render: (_, record) => <div>{record.key}</div>,
                            width: 152,
                        },
                        {
                            title: "Note",
                            key: "text",
                            dataIndex: "text",
                            render: (_, record) => (
                                <div className="w-fit text-wrap">{record.value.value}</div>
                            ),
                        },
                    ]}
                    dataSource={Object.entries(record?.data?.outputs?.notes || {}).map(
                        ([key, value]) => ({
                            key,
                            value,
                        }),
                    )}
                    rowKey={(note, index) => `${note}-${index}`}
                    pagination={false}
                    bordered
                    showHeader={false}
                    size="small"
                    className={classes.expandableTable}
                />
            </div>
        ),
        expandIcon: ({expanded, onExpand, record}) => {
            const notes = record?.data?.outputs?.notes || {}
            const hasNotes = Object.keys(notes).length > 0

            if (!hasNotes) return <div className="not-available-table-cell"></div> // Don't render expand icon if no notes

            return (
                <Flex align="center" gap={10}>
                    <Button
                        className="!w-[16px] !h-4 !p-0.5 !rounded-sm flex items-center justify-center"
                        onClick={(e) => onExpand(record, e)}
                        variant="outline"
                        size="icon-sm"
                    >
                        {expanded ? (
                            <MinusOutlined className="w-3 h-3 mt-0.5" />
                        ) : (
                            <PlusOutlined className="w-3 h-3 mt-0.5" />
                        )}
                    </Button>
                    <div className="flex items-center gap-1.5">
                        <ChatText size={16} />
                        <Badge className="h-[14px] min-w-[14px] rounded-[4px] text-[10px] px-1 bg-black text-white leading-none">
                            {Object.values(notes).length}
                        </Badge>
                    </div>
                </Flex>
            )
        },
        rowExpandable: (record) => Object.values(record?.data?.outputs?.notes || {}).length > 0,
        columnWidth: 100,
        fixed: "left",
    }
    return (
        <Space orientation="vertical" size={16} className="w-full">
            {Object.entries(groupedByReference).length > 0 ? (
                Object.entries(groupedByReference).map(([key, annotations]) => {
                    const [slug, kind] = key.split("::")
                    const evaluator = annotations?.[0]?.evaluator
                    const evaluatorName = evaluator?.name || slug
                    return (
                        <Space orientation="vertical" key={key} className="w-full @container">
                            <div className="w-full flex items-center justify-between">
                                <EvaluatorDetailsPopover evaluator={evaluator} fallbackLabel={slug}>
                                    <span className="font-medium">{evaluatorName}</span>
                                </EvaluatorDetailsPopover>

                                <span className="capitalize text-muted-foreground">
                                    {kind} evaluator
                                </span>
                            </div>

                            <Table
                                columns={getAnnotationTableColumns(slug, annotations)}
                                pagination={false}
                                scroll={{x: "max-content"}}
                                bordered
                                expandable={expandable}
                                dataSource={annotations}
                                className={clsx(
                                    "[&_.ant-table-expanded-row-fixed]:!w-[100cqw] [&_.ant-table-expanded-row-fixed]:!px-0 [&_.ant-table-expanded-row-fixed]:!sticky [&_.ant-table-expanded-row-fixed]:!left-0",
                                    classes.table,
                                )}
                                rowKey="span_id"
                            />
                        </Space>
                    )
                })
            ) : (
                <NoTraceAnnotations />
            )}
        </Space>
    )
}

export default AnnotationTabItem
