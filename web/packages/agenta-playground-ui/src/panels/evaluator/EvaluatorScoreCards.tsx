import {useMemo} from "react"

import type {RunnablePort} from "@agenta/entities/runnable"
import {workflowMolecule} from "@agenta/entities/workflow"
import {executionItemController, playgroundController} from "@agenta/playground"
import type {PlaygroundNode} from "@agenta/playground/state"
import {Badge, Skeleton} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import {
    extractDisplayEntries,
    formatFieldLabel,
    isVerdictFieldKey,
    parseBooleanLikeValue,
} from "../../utils/evaluatorFields"

interface StageResult {
    status?: string
    output?: unknown
    error?: {message?: string} | null
}

const formatValue = (value: unknown) =>
    typeof value === "string" ? value : JSON.stringify(value, null, 2)

/** The fields of a finished result, limited to the evaluator's declared outputs when it has them. */
const fieldsOf = (output: unknown, ports: RunnablePort[]): [string, unknown][] => {
    const entries = extractDisplayEntries(output) ?? []
    const declared = new Set(ports.filter((port) => !port.isFallback).map((port) => port.key))
    const kept = entries.filter(([key]) => declared.has(key))
    return kept.length > 0 ? kept : entries
}

const ScoreCard = ({
    rowId,
    rootEntityId,
    node,
}: {
    rowId: string
    rootEntityId: string
    node: PlaygroundNode
}) => {
    // An evaluator's result is kept per app revision: `sess:<app>:<evaluator>`.
    const scopedId = `${rootEntityId}:${node.entityId}`
    const result = useAtomValue(
        useMemo(
            () => executionItemController.selectors.fullResult({rowId, entityId: scopedId}),
            [rowId, scopedId],
        ),
    ) as StageResult | null
    // A stage the runner skipped (a required input is missing) is published as a plain success;
    // the app's own result keeps the stage's real status and the reason.
    const appResult = useAtomValue(
        useMemo(
            () => executionItemController.selectors.fullResult({rowId, entityId: rootEntityId}),
            [rowId, rootEntityId],
        ),
    ) as {chainResults?: Record<string, StageResult>} | null
    const skipped = appResult?.chainResults?.[node.id]?.status === "skipped"
    const ports = useAtomValue(workflowMolecule.selectors.outputPorts(node.entityId))
    const name = useAtomValue(workflowMolecule.selectors.artifactName(node.entityId))
    const status = skipped ? "skipped" : (result?.status ?? "idle")
    const error = skipped ? appResult?.chainResults?.[node.id]?.error : result?.error

    const body = (() => {
        if (status === "running" || status === "pending") {
            return <Skeleton className="h-4 w-32" />
        }
        if (status === "error" || status === "skipped") {
            return (
                <p
                    className={
                        status === "error"
                            ? "m-0 text-xs text-error"
                            : "m-0 text-xs italic text-muted-foreground"
                    }
                >
                    {error?.message || (status === "error" ? "Error" : "Skipped")}
                </p>
            )
        }
        const fields = status === "success" ? fieldsOf(result?.output, ports) : []
        if (fields.length === 0) {
            return <p className="m-0 text-xs text-muted-foreground">—</p>
        }
        return (
            <dl className="m-0 grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1.5 text-xs">
                {fields.map(([key, value]) => {
                    const verdict = isVerdictFieldKey(key) ? parseBooleanLikeValue(value) : null
                    return (
                        <div key={key} className="contents">
                            <dt className="whitespace-nowrap text-muted-foreground">
                                {formatFieldLabel(key)}:
                            </dt>
                            <dd className="m-0 min-w-0 whitespace-pre-wrap break-words text-foreground">
                                {verdict === null ? (
                                    formatValue(value)
                                ) : (
                                    <Badge variant={verdict ? "success" : "error"}>
                                        {verdict ? "true" : "false"}
                                    </Badge>
                                )}
                            </dd>
                        </div>
                    )
                })}
            </dl>
        )
    })()

    return (
        <section
            data-testid={`evaluator-score-${node.entityId}`}
            className="flex flex-col gap-2 rounded-md border border-solid border-border px-3 py-2"
        >
            <h4 className="m-0 truncate text-xs font-medium text-foreground">
                {name?.trim() || node.label || "Evaluator"}
            </h4>
            {body}
        </section>
    )
}

/**
 * One card per evaluator that runs after the app, under a test case's result: a placeholder
 * while it runs, then its fields (a pass or fail field shows as true or false), its error, or the
 * reason it was skipped. Nothing shows when no evaluator follows the app.
 */
export const EvaluatorScoreCards = ({rowId, entityId}: {rowId: string; entityId: string}) => {
    const nodes = useAtomValue(playgroundController.selectors.nodes())
    const evaluators = nodes.filter((node) => node.depth > 0)
    if (evaluators.length === 0) return null
    return (
        <div className="flex flex-col gap-2">
            {evaluators.map((node) => (
                <ScoreCard key={node.id} rowId={rowId} rootEntityId={entityId} node={node} />
            ))}
        </div>
    )
}
