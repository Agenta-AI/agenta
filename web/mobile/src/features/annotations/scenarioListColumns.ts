import type {ScenarioEvaluatorKey, ScenarioListColumnDef} from "@agenta/annotation"
import {formatScenarioValue} from "@agenta/annotation"

type AnnotationColumn = Extract<ScenarioListColumnDef, {columnType: "annotation"}>

/** One metric shown in an evaluator's cell: its label and how to look its value up. */
export interface EvaluatorMetric {
    key: string
    title: string
    lookup: Omit<ScenarioEvaluatorKey, "scenarioId">
}

/** An evaluator column of the All Annotations list: its title and the metrics it stacks. */
export interface EvaluatorColumn {
    key: string
    title: string
    metrics: EvaluatorMetric[]
}

/** The evaluator columns, from the controller's column definitions. Other kinds are dropped. */
export const toEvaluatorColumns = (defs: ScenarioListColumnDef[]): EvaluatorColumn[] =>
    defs
        .filter((def): def is AnnotationColumn => def.columnType === "annotation")
        .map((def) => {
            const base = def.annotationDef
            const children =
                def.outputColumns ??
                def.outputKeys.map((outputKey) => ({
                    key: `${def.key}_${outputKey}`,
                    title: outputKey,
                    annotationDef: {...base, path: outputKey},
                }))
            const metrics = (
                children.length > 0
                    ? children
                    : [{key: def.key, title: def.title, annotationDef: base}]
            ).map((child) => ({
                key: child.key,
                title: child.title,
                lookup: {
                    evaluatorId: child.annotationDef.evaluatorId,
                    evaluatorSlug: child.annotationDef.evaluatorSlug,
                    path: child.annotationDef.path,
                    stepKey: child.annotationDef.stepKey,
                },
            }))
            return {key: def.key, title: def.title, metrics}
        })

/** A metric value as search text: objects as JSON, nothing as "". */
export const metricSearchText = (value: unknown) =>
    value === null || value === undefined ? "" : formatScenarioValue(value)
