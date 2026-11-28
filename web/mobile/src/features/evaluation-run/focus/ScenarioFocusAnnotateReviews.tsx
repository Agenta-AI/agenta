import {useEffect, useRef} from "react"

import type {AnnotationMetricField} from "@agenta/annotation"
import {resolveOutputSchemaProperties, workflowMolecule} from "@agenta/entities/workflow"
import {useT} from "@agenta/i18n"
import valueViewCatalog from "@agenta/i18n/catalogs/chat.valueView"
import annotateCatalog from "@agenta/i18n/catalogs/evaluations.scenarioFocusAnnotate"
import {cn} from "@agenta/ui/styles"
import {AutosizeTextarea, Badge, Segmented} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import {AnnotationField} from "@/features/annotations/AnnotationField"

import type {ReviewDraft, ScenarioJudge} from "./useJudgeReviews"

/** Output types a person corrects in place; text (a reason) keeps the judge's value. */
const CORRECTABLE = new Set(["boolean", "number", "integer"])

const typeOf = (schema: Record<string, unknown>, value: unknown): string | null => {
    const type = Array.isArray(schema.type) ? schema.type[0] : schema.type
    if (typeof type === "string") return type
    if (Array.isArray(schema.enum) || Array.isArray(schema.anyOf)) return "string"
    return typeof value === "boolean" ? "boolean" : typeof value === "number" ? "number" : null
}

/**
 * "Corrected value": the judge's own output fields that hold a flag or a number, from its output
 * schema (else from its values), each drawn as the annotation form draws it, prefilled with the
 * judge's value.
 */
const JudgeCorrection = ({
    judge,
    draft,
    readOnly,
    onChange,
}: {
    judge: ScenarioJudge
    draft: ReviewDraft
    readOnly: boolean
    onChange: (next: ReviewDraft) => void
}) => {
    const t = useT(annotateCatalog)
    const data = useAtomValue(workflowMolecule.selectors.data(judge.revisionId ?? ""))?.data
    const properties = resolveOutputSchemaProperties(data) ?? {}
    const names = [...new Set([...Object.keys(properties), ...Object.keys(judge.outputs)])]
    const fields = names.flatMap((name) => {
        const schema = (properties[name] ?? {}) as Record<string, unknown>
        const value = name in draft.corrected ? draft.corrected[name] : judge.outputs[name]
        const type = typeOf(schema, value)
        if (!type || !CORRECTABLE.has(type)) return []
        const field: AnnotationMetricField = {...schema, type, value}
        return [[name, field] as const]
    })
    return (
        <div className="flex flex-col gap-3 rounded-lg bg-muted p-3">
            {fields.length > 0 ? (
                <div className="flex flex-col gap-2">
                    <span className="text-meta text-muted-foreground">
                        {t("evaluations.scenarioFocusAnnotate.correctedValue")}
                    </span>
                    {fields.map(([name, field]) => (
                        <AnnotationField
                            key={name}
                            fieldKey={name}
                            field={field}
                            readOnly={readOnly}
                            onChange={(value) =>
                                onChange({...draft, corrected: {...draft.corrected, [name]: value}})
                            }
                        />
                    ))}
                </div>
            ) : null}
            <label className="flex flex-col gap-1">
                <span className="text-meta text-muted-foreground">
                    {t("evaluations.scenarioFocusAnnotate.note")}
                </span>
                <AutosizeTextarea
                    value={draft.note}
                    readOnly={readOnly}
                    autoSize={{minRows: 2, maxRows: 8}}
                    onChange={(event) => onChange({...draft, note: event.target.value})}
                />
            </label>
        </div>
    )
}

/**
 * The "Evaluator results" part of the Annotate panel: "Agree" and "Disagree" on the failed
 * automatic evaluators (and on any the user reviewed or opened from a mark), "Disagree" opens the
 * corrected value and a note. The header counts the failed ones reviewed.
 */
export const ScenarioFocusAnnotateReviews = ({
    judges,
    draftFor,
    onDraft,
    focusJudge,
    readOnly,
}: {
    judges: readonly ScenarioJudge[]
    draftFor: (judgeId: string) => ReviewDraft | null
    onDraft: (judgeId: string, next: ReviewDraft) => void
    /** The judge whose mark opened the panel: highlighted and scrolled into view. */
    focusJudge: string | null
    readOnly: boolean
}) => {
    const t = useT(annotateCatalog, valueViewCatalog)
    const focusRef = useRef<HTMLDivElement>(null)
    useEffect(() => {
        focusRef.current?.scrollIntoView?.({block: "nearest"})
    }, [focusJudge])

    const failed = judges.filter((judge) => judge.failed)
    const shown = judges.filter(
        (judge) => judge.failed || judge.id === focusJudge || draftFor(judge.id),
    )
    if (shown.length === 0) return null
    const reviewed = failed.filter((judge) => draftFor(judge.id)).length

    return (
        <section
            aria-label={t("evaluations.scenarioFocusAnnotate.evaluatorResults")}
            className="flex flex-col border-0 border-b border-solid border-border"
        >
            <div className="flex items-center justify-between gap-2 bg-muted px-3 py-2">
                <h3 className="m-0 text-label">
                    {t("evaluations.scenarioFocusAnnotate.evaluatorResults")}
                </h3>
                {failed.length > 0 ? (
                    <span className="text-meta text-muted-foreground">
                        {t("evaluations.scenarioFocusAnnotate.failedReviewed", {
                            reviewed,
                            total: failed.length,
                        })}
                    </span>
                ) : null}
            </div>
            {shown.map((judge) => {
                const draft = draftFor(judge.id)
                const answer = (verdict: ReviewDraft["verdict"]) =>
                    onDraft(judge.id, {
                        verdict,
                        corrected: draft?.corrected ?? {},
                        note: draft?.note ?? "",
                    })
                const focused = judge.id === focusJudge
                return (
                    <div
                        key={judge.id}
                        ref={focused ? focusRef : undefined}
                        data-testid={`review-${judge.id}`}
                        className={cn(
                            "flex flex-col gap-2 border-0 border-b border-solid border-border-muted px-3 py-2.5 last:border-b-0",
                            focused && "bg-selected",
                        )}
                    >
                        <div className="flex min-w-0 items-center gap-2">
                            <span className="min-w-0 flex-1 truncate text-body" title={judge.name}>
                                {judge.slug ?? judge.name}
                            </span>
                            {judge.failed ? (
                                <Badge variant="destructive">{t("chat.valueView.fail")}</Badge>
                            ) : null}
                            <div inert={readOnly}>
                                <Segmented
                                    size="sm"
                                    aria-label={judge.name}
                                    options={[
                                        {
                                            value: "agree",
                                            label: t("evaluations.scenarioFocusAnnotate.agree"),
                                        },
                                        {
                                            value: "disagree",
                                            label: t("evaluations.scenarioFocusAnnotate.disagree"),
                                        },
                                    ]}
                                    value={draft?.verdict ?? ""}
                                    onChange={(next) => answer(next as ReviewDraft["verdict"])}
                                />
                            </div>
                        </div>
                        {draft?.verdict === "disagree" ? (
                            <JudgeCorrection
                                judge={judge}
                                draft={draft}
                                readOnly={readOnly}
                                onChange={(next) => onDraft(judge.id, next)}
                            />
                        ) : null}
                    </div>
                )
            })}
        </section>
    )
}
