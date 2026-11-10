import {useState, type ReactNode} from "react"

import {WorkflowTypeTag} from "@agenta/entity-ui/workflow"
import {Badge, CollapseCaret} from "@agenta/ui/ui"

import {cn} from "@/lib/utils"

import {useRevisionParam} from "../../revisions/useRevisionParam"

import {ConfigJsonDisclosure} from "./ConfigJsonDisclosure"
import {ConfigRows} from "./ConfigRows"
import {DiffersBadge} from "./DiffersBadge"
import type {EvaluatorConfig} from "./useEvaluatorConfigs"

const MISSING = "—"

/** A setting as one line of text: a string as it is, anything else as compact JSON. */
const settingText = (value: unknown): string =>
    typeof value === "string" ? value : (JSON.stringify(value) ?? MISSING)

/** A small labelled block of the open card, as the old app lays them out. */
const Field = ({label, children}: {label: string; children: ReactNode}) => (
    <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {children}
    </div>
)

/**
 * One evaluator of the run: its name (opens the revision drawer), version, description, type,
 * settings and the output metrics it returns. The card collapses; a run that names no revision
 * shows "Latest" instead of a version.
 */
export const EvaluatorConfigCard = ({
    evaluator,
    defaultOpen,
    differs = false,
}: {
    evaluator: EvaluatorConfig
    defaultOpen: boolean
    /** Compare mode: the base run lacks this evaluator or used another version. */
    differs?: boolean
}) => {
    const [open, setOpen] = useState(defaultOpen)
    const [, setRevisionId] = useRevisionParam()
    const {name, description, version, latest, revisionId, settings, evaluatorKey, outputs} =
        evaluator

    const settingRows = Object.entries(settings ?? {}).map(([key, value]) => ({
        key,
        label: key,
        value: (
            <span className="whitespace-pre-wrap break-words font-mono text-xs">
                {settingText(value)}
            </span>
        ),
    }))

    return (
        <div
            data-testid="evaluator-card"
            data-differs={differs ? "true" : undefined}
            className={cn(
                "box-border flex min-w-0 flex-col gap-3 rounded-md border border-solid border-border p-3",
                differs && "bg-colorWarningBg/40",
            )}
        >
            <div className="flex min-w-0 items-start gap-2">
                <button
                    type="button"
                    aria-expanded={open}
                    aria-label={open ? `Collapse ${name}` : `Expand ${name}`}
                    onClick={() => setOpen((current) => !current)}
                    className="m-0 mt-0.5 flex shrink-0 cursor-pointer items-center border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground"
                >
                    <CollapseCaret open={open} size={14} className="text-current" />
                </button>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <button
                            type="button"
                            disabled={!revisionId}
                            onClick={() => revisionId && setRevisionId(revisionId)}
                            className="m-0 min-w-0 cursor-pointer break-words border-0 bg-transparent p-0 text-left text-sm font-semibold text-foreground hover:underline disabled:cursor-default disabled:no-underline"
                        >
                            {name}
                        </button>
                        {latest ? (
                            <Badge variant="outlined">Latest</Badge>
                        ) : version === null ? null : (
                            <Badge variant="outlined">V{version}</Badge>
                        )}
                        {differs ? <DiffersBadge /> : null}
                    </div>
                    {description && !open ? (
                        <p className="m-0 truncate text-sm text-muted-foreground">{description}</p>
                    ) : null}
                </div>
            </div>
            {open ? (
                <div className="flex min-w-0 flex-col gap-3">
                    {description ? (
                        <p className="m-0 break-words text-sm text-muted-foreground">
                            {description}
                        </p>
                    ) : null}
                    {evaluatorKey ? (
                        <Field label="Evaluator type">
                            <span className="flex">
                                <WorkflowTypeTag isEvaluator workflowKey={evaluatorKey} />
                            </span>
                        </Field>
                    ) : null}
                    {settingRows.length > 0 ? <ConfigRows rows={settingRows} /> : null}
                    {outputs.length > 0 ? (
                        <Field label="Output metrics">
                            <ul className="m-0 flex list-none flex-col gap-1 rounded-md border border-solid border-border p-2">
                                {outputs.map((metric) => (
                                    <li
                                        key={metric.name}
                                        className="flex min-w-0 flex-wrap items-center gap-2 text-sm"
                                    >
                                        <span className="font-semibold text-foreground">
                                            {metric.name}
                                        </span>
                                        {metric.type ? (
                                            <Badge variant="outlined">{metric.type}</Badge>
                                        ) : null}
                                        {metric.required ? (
                                            <Badge variant="outlined">Required</Badge>
                                        ) : null}
                                    </li>
                                ))}
                            </ul>
                        </Field>
                    ) : null}
                    <ConfigJsonDisclosure value={evaluator.snapshot} />
                </div>
            ) : null}
        </div>
    )
}
