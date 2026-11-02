import {useMemo, useState} from "react"

import {
    deriveEvaluatorTypeLabel,
    extractEvaluatorParameters,
    parseOutputMetrics,
} from "@agenta/annotation"
import {resolveOutputSchema, workflowMolecule} from "@agenta/entities/workflow"
import {Badge, Button, Segmented, SkeletonBlock} from "@agenta/ui/ui"
import {CaretDown} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import {QueueConfigField} from "./QueueConfigField"

const ReadOnlyEditor = dynamic(() => import("./ReadOnlyEditor").then((m) => m.ReadOnlyEditor), {
    ssr: false,
})

const VIEW_OPTIONS = [
    {value: "details", label: "Details"},
    {value: "json", label: "JSON"},
]

/** The evaluator as pretty JSON. A cycle prints as "[Circular]" instead of throwing. */
const toJson = (value: unknown): string => {
    if (!value) return ""
    const seen = new WeakSet<object>()
    try {
        return JSON.stringify(
            value,
            (_key, item: unknown) => {
                if (typeof item === "object" && item !== null) {
                    if (seen.has(item)) return "[Circular]"
                    seen.add(item)
                }
                return typeof item === "function" ? undefined : item
            },
            2,
        )
    } catch {
        return ""
    }
}

const Box = ({children}: {children: React.ReactNode}) => (
    <div className="rounded-md border border-solid border-border bg-muted/40 px-2.5 py-1.5">
        {children}
    </div>
)

/** One evaluator of the queue: name, version, kind, then its details or its JSON. */
export const QueueEvaluatorCard = ({evaluatorId}: {evaluatorId: string}) => {
    const [open, setOpen] = useState(true)
    const [view, setView] = useState<"details" | "json">("details")
    const query = useAtomValue(workflowMolecule.selectors.query(evaluatorId))
    const evaluator = useAtomValue(workflowMolecule.selectors.data(evaluatorId))
    const artifactName = useAtomValue(workflowMolecule.selectors.artifactName(evaluatorId))

    const data = evaluator?.data as Record<string, unknown> | null | undefined
    const parameters = useMemo(() => extractEvaluatorParameters(data), [data])
    const metrics = useMemo(() => parseOutputMetrics(resolveOutputSchema(data)), [data])
    const json = useMemo(() => toJson(evaluator), [evaluator])

    if (query.isPending) {
        return (
            <div
                className="flex flex-col gap-2 p-4"
                role="status"
                aria-label="Loading the evaluator"
            >
                <SkeletonBlock className="h-4 w-40" />
                <SkeletonBlock className="h-4" />
            </div>
        )
    }

    const name = artifactName || evaluator?.slug || evaluatorId.slice(0, 8)
    const isHuman = evaluator?.flags?.is_feedback ?? false
    const typeLabel = deriveEvaluatorTypeLabel(evaluator?.data?.uri)
    const description = evaluator?.description
    const hasJson = json.trim().length > 0
    const shownView = hasJson ? view : "details"

    return (
        <div className="flex flex-col">
            <div className="flex min-h-10 items-center justify-between gap-2 bg-muted/40 px-3 py-1.5">
                <div className="flex min-w-0 items-center gap-2">
                    <span
                        className="min-w-0 truncate text-sm font-medium text-foreground"
                        title={name}
                    >
                        {name}
                    </span>
                    {evaluator?.version ? <Badge>{`V${evaluator.version}`}</Badge> : null}
                    {isHuman ? <Badge variant="purple">Human</Badge> : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    {hasJson && open ? (
                        <Segmented
                            size="sm"
                            aria-label="Evaluator view"
                            options={VIEW_OPTIONS}
                            value={shownView}
                            onChange={(next) => setView(next as "details" | "json")}
                        />
                    ) : null}
                    <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        aria-label={open ? "Collapse" : "Expand"}
                        aria-expanded={open}
                        onClick={() => setOpen((value) => !value)}
                    >
                        <CaretDown
                            aria-hidden
                            size={12}
                            className={
                                open ? "transition-transform" : "-rotate-90 transition-transform"
                            }
                        />
                    </Button>
                </div>
            </div>
            {open ? (
                <div className="flex flex-col gap-3 p-3">
                    {shownView === "json" ? (
                        <div className="overflow-hidden rounded-md border border-solid border-border">
                            <ReadOnlyEditor
                                id={`queue-evaluator-${evaluatorId}`}
                                value={json}
                                language="json"
                            />
                        </div>
                    ) : (
                        <>
                            {typeLabel ? (
                                <QueueConfigField label="Evaluator type">
                                    <Badge variant={isHuman ? "purple" : "default"}>
                                        {typeLabel}
                                    </Badge>
                                </QueueConfigField>
                            ) : null}
                            {description ? (
                                <QueueConfigField label="Description">
                                    <span className="text-muted-foreground">{description}</span>
                                </QueueConfigField>
                            ) : null}
                            {parameters.map((parameter) => (
                                <QueueConfigField key={parameter.key} label={parameter.label}>
                                    <Box>
                                        {parameter.isMultiline ? (
                                            <pre className="m-0 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs">
                                                {parameter.displayValue}
                                            </pre>
                                        ) : (
                                            <span className="break-words">
                                                {parameter.displayValue}
                                            </span>
                                        )}
                                    </Box>
                                </QueueConfigField>
                            ))}
                            {metrics.length > 0 ? (
                                <QueueConfigField label="Output metrics">
                                    <Box>
                                        <ul className="m-0 flex list-none flex-col gap-1 p-0">
                                            {metrics.map((metric) => (
                                                <li key={metric.name} className="break-words">
                                                    <span className="font-medium">
                                                        {metric.name}
                                                    </span>
                                                    <span className="text-muted-foreground">{`: ${metric.type}`}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </Box>
                                </QueueConfigField>
                            ) : null}
                        </>
                    )}
                </div>
            ) : null}
        </div>
    )
}
