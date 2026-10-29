import {useMemo} from "react"

import {AnnotationDto} from "@agenta/entities/annotation/dto"
import {evaluatorsListDataAtom, resolveOutputSchemaProperties} from "@agenta/entities/workflow"
import {getStringOrJson} from "@agenta/shared/utils"
import {useAtomValue} from "jotai"

import {SimpleTable} from "../primitives/SimpleTable"

// Mirrors `AnnotateDrawer/assets/constants`; duplicated rather than reaching into that drawer.
const USEABLE_METRIC_TYPES = ["string", "number", "integer", "float", "boolean"]
const NUMERIC_METRIC_TYPES = ["number", "integer", "float"]
import EvaluatorDetailsPopover from "./EvaluatorDetailsPopover"
import {getAnnotationTableColumns} from "./getAnnotationTableColumns"
import NoTraceAnnotations from "./NoTraceAnnotations"

const AnnotationTabItem = ({annotations}: {annotations: AnnotationDto[]}) => {
    const evaluators = useAtomValue(evaluatorsListDataAtom)

    // Last minute changes to display multiselect values in the table. This is not the best way to do it but it works for now.
    const mergedAnnWithEvaluator = useMemo(() => {
        return annotations.map((ann) => {
            const outputs = (ann.data?.outputs as Record<string, Record<string, unknown>>) || {}
            const allAnnMetrics = {...outputs.metrics, ...outputs.notes, ...outputs.extra}
            const evaluator = evaluators.find((e) => e.slug === ann.references?.evaluator?.slug)

            const evalMetricsSchema: Record<string, unknown> =
                resolveOutputSchemaProperties(evaluator?.data) ?? {}

            const grouped = Object.entries(allAnnMetrics).reduce(
                (acc, [key, value]) => {
                    // Evaluator metric schemas are JSON-schema fragments.
                    const schema = evalMetricsSchema[key] as
                        | {anyOf?: unknown; type?: string}
                        | undefined
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
                {metrics: {}, notes: {}, extra: {}} as Record<string, Record<string, unknown>>,
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
            acc[key].push({...item} as AnnotationDto)
            return acc
        },
        {} as Record<string, AnnotationDto[]>,
    )

    // antd drove expansion through `expandable.expandIcon` + internal state; SimpleTable renders
    // the expanded row unconditionally, so a row with no notes simply renders nothing.
    const renderNotes = (record: AnnotationDto) => {
        const notes = (record?.data?.outputs?.notes || {}) as Record<string, unknown>
        if (!Object.keys(notes).length) return null

        return (
            <SimpleTable<{key: string; value: unknown}>
                columns={[
                    {
                        title: "User",
                        key: "user",
                        dataIndex: "key",
                        render: (_value, note) => <div>{note.key}</div>,
                        width: 152,
                    },
                    {
                        title: "Note",
                        key: "text",
                        dataIndex: "value",
                        render: (_value, note) => (
                            <div className="w-fit text-wrap">
                                {getStringOrJson(note.value as string)}
                            </div>
                        ),
                    },
                ]}
                dataSource={Object.entries(notes).map(([key, value]) => ({key, value}))}
                rowKey={(note) => note.key}
                bordered
            />
        )
    }
    return (
        <div className="flex flex-col gap-4 w-full">
            {Object.entries(groupedByReference).length > 0 ? (
                Object.entries(groupedByReference).map(([key, annotations]) => {
                    const [slug, kind] = key.split("::")
                    // `evaluator` is not on AnnotationDto; dead access kept as-is (falls through to slug)
                    const evaluator = (annotations?.[0] as {evaluator?: unknown} | undefined)
                        ?.evaluator
                    const evaluatorName = (evaluator as {name?: string} | undefined)?.name || slug
                    return (
                        <div key={key} className="flex flex-col gap-2 w-full @container">
                            <div className="w-full flex items-center justify-between">
                                <EvaluatorDetailsPopover
                                    evaluator={evaluator as never}
                                    fallbackLabel={slug}
                                >
                                    <span className="font-medium">{evaluatorName}</span>
                                </EvaluatorDetailsPopover>

                                <span className="text-colorTextSecondary capitalize">
                                    {kind} evaluator
                                </span>
                            </div>

                            <SimpleTable
                                columns={getAnnotationTableColumns(slug, annotations)}
                                bordered
                                expandedRowRender={renderNotes}
                                dataSource={annotations}
                                rowKey="span_id"
                            />
                        </div>
                    )
                })
            ) : (
                <NoTraceAnnotations />
            )}
        </div>
    )
}

export default AnnotationTabItem
