import {useMemo, useState, type ReactNode} from "react"

import {richText, useT} from "@agenta/i18n"
import chatActivityCatalog from "@agenta/i18n/catalogs/chat.activity"
import {isInteractionEndedOutput} from "@agenta/shared/clientTools"
import {
    buildElicitationSteps,
    deriveElicitationPartState,
    formatStepValue,
    parseElicitationPayload,
} from "@agenta/shared/utils"
import type {ToolUIPart} from "ai"

import RevealCollapse from "../RevealCollapse"

import {
    ActivityNode,
    LIVE_TEXT_CLASS,
    StepCaret,
    StepRow,
    type ActivityState,
} from "./activityIcons"

/** A question on the timeline: what the dock below waits on, then what the reader said. */
export const ActivityAnswersStep = ({part}: {part: ToolUIPart}) => {
    const t = useT(chatActivityCatalog)
    const withCount = (text: string) =>
        richText(text, {count: (children) => <strong className="font-medium">{children}</strong>})
    const [open, setOpen] = useState(false)
    const input = (part as {input?: unknown}).input
    const output = (part as {output?: unknown}).output
    const settled = deriveElicitationPartState({
        state: part.state,
        output,
        errorText: (part as {errorText?: string}).errorText,
    })
    const ended = isInteractionEndedOutput(output)

    const answers = useMemo(() => {
        if (settled !== "submitted" || ended) return []
        const parsed = parseElicitationPayload(input)
        if (!parsed.ok) return []
        const content =
            output && typeof output === "object"
                ? ((output as {content?: Record<string, unknown>}).content ?? {})
                : {}
        return buildElicitationSteps(parsed.payload)
            .steps.filter((step) => content[step.name] !== undefined)
            .map((step) => ({
                key: step.name,
                label: step.label,
                value: formatStepValue(step, content[step.name]),
            }))
    }, [settled, ended, input, output])

    // Still open: the questions are in the dock below; this row only says so.
    const pendingCount = useMemo(() => {
        if (settled !== "pending") return 0
        const parsed = parseElicitationPayload(input)
        return parsed.ok ? buildElicitationSteps(parsed.payload).steps.length : 0
    }, [settled, input])

    const count = answers.length
    let sentence: ReactNode
    let state: ActivityState = "idle"
    if (settled === "pending") {
        sentence = pendingCount
            ? withCount(t("chat.activity.needsAnswersTo", {count: pendingCount}))
            : t("chat.activity.needsAnswerBelow")
    } else if (ended) {
        sentence = t("chat.activity.questionUnanswered")
        state = "responded"
    } else if (settled === "declined" || settled === "cancelled") {
        sentence = t("chat.activity.youDeclined")
        state = "denied"
    } else if (settled === "degraded") {
        sentence = t("chat.activity.questionNotShown")
        state = "not-handled"
    } else {
        sentence = count
            ? withCount(t("chat.activity.youAnsweredQuestions", {count}))
            : t("chat.activity.youAnsweredPlain")
    }

    const expandable = count > 0
    return (
        <div className="flex min-w-0 flex-col gap-2">
            <StepRow open={open} onToggle={expandable ? () => setOpen((v) => !v) : undefined}>
                <ActivityNode icon="ask" state={state} yourTurn={settled === "pending"} />
                <span
                    className={`min-w-0 truncate text-sm text-colorText transition-colors group-hover/row:text-colorTextSecondary ${
                        settled === "pending" ? LIVE_TEXT_CLASS : ""
                    }`}
                >
                    {sentence}
                </span>
                {expandable ? <StepCaret open={open} /> : null}
            </StepRow>
            <RevealCollapse open={open}>
                <dl className="ag-surface-inset m-0 flex min-w-0 flex-col gap-2 rounded px-3 py-2 text-xs ml-[38px]">
                    {answers.map((answer) => (
                        <div key={answer.key} className="flex min-w-0 flex-col gap-0.5">
                            <dt className="font-mono text-[12px] text-colorTextTertiary">
                                {answer.label}
                            </dt>
                            <dd className="m-0 break-words text-colorText">{answer.value}</dd>
                        </div>
                    ))}
                </dl>
            </RevealCollapse>
        </div>
    )
}
