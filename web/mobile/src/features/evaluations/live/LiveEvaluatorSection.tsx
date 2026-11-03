import {useMemo} from "react"

import type {Workflow} from "@agenta/entities/workflow"
import {LoadError} from "@agenta/ui/components/presentational"
import {Combobox, Field} from "@agenta/ui/ui"
import Link from "next/link"

import {LiveEvaluatorSummary} from "./LiveEvaluatorSummary"
import type {useLiveEvaluators} from "./useLiveEvaluators"

/** Pick the one evaluator that scores each live trace. */
export const LiveEvaluatorSection = ({
    list,
    value,
    error,
    disabled,
    evaluatorsHref,
    onPick,
}: {
    list: ReturnType<typeof useLiveEvaluators>
    value: string | null
    error: string | null
    disabled?: boolean
    /** Where "Open evaluator registry" goes. Null while the evaluators view is off: no link then. */
    evaluatorsHref: string | null
    onPick: (evaluator: Workflow) => void
}) => {
    const options = useMemo(
        () =>
            list.evaluators.map((evaluator) => ({
                value: evaluator.id,
                label: evaluator.name ?? evaluator.slug ?? evaluator.id,
                searchValue: [
                    evaluator.name,
                    evaluator.slug,
                    evaluator.id,
                    evaluator.workflow_id,
                    evaluator.data?.uri,
                ]
                    .filter(Boolean)
                    .join(" "),
            })),
        [list.evaluators],
    )
    const picked = list.evaluators.find((evaluator) => evaluator.id === value)

    if (list.isError) return <LoadError title="Could not load evaluators" onRetry={list.retry} />

    const noneSupported = !list.isPending && list.evaluators.length === 0

    return (
        <div className="flex flex-col gap-3">
            <Field label="Evaluator" required error={error}>
                <Combobox
                    aria-label="Evaluator"
                    options={options}
                    value={value ?? undefined}
                    loading={list.isPending}
                    placeholder={list.isPending ? "Loading evaluators..." : "Select"}
                    disabled={disabled || noneSupported}
                    invalid={Boolean(error)}
                    onChange={(next) => {
                        const evaluator = list.evaluators.find((e) => e.id === next)
                        if (evaluator) onPick(evaluator)
                    }}
                />
            </Field>
            {noneSupported ? (
                <div className="flex flex-col items-start gap-1">
                    <p className="m-0 text-sm text-muted-foreground">
                        No supported evaluators are available. Add an evaluator configured as
                        Custom, LLM-as-a-judge, Code, Regex test, or Webhook test to continue.
                    </p>
                    {evaluatorsHref ? (
                        <Link
                            href={evaluatorsHref}
                            prefetch={false}
                            className="text-sm font-medium text-foreground underline"
                        >
                            Open evaluator registry
                        </Link>
                    ) : null}
                </div>
            ) : null}
            {picked ? <LiveEvaluatorSummary evaluator={picked} /> : null}
        </div>
    )
}
