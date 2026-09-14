import {useMemo, useState, type ReactNode} from "react"

import {isInteractionEndedOutput} from "@agenta/shared/clientTools"
import {
    buildElicitationSteps,
    deriveElicitationPartState,
    formatStepValue,
    parseElicitationPayload,
} from "@agenta/shared/utils"
import {CaretDown} from "@phosphor-icons/react"
import type {ToolUIPart} from "ai"

import RevealCollapse from "../RevealCollapse"

import {ActivityNode, type ActivityState} from "./activityIcons"

/**
 * A question on the timeline, in the same row shape as every other step: while open, that the
 * dock below is waiting on the reader; once settled, what they said. The form itself never
 * renders here.
 */
export const ActivityAnswersStep = ({part}: {part: ToolUIPart}) => {
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
        sentence = pendingCount ? (
            <>
                Needs your answers to{" "}
                <strong className="font-medium">
                    {pendingCount} {pendingCount === 1 ? "question" : "questions"}
                </strong>{" "}
                below
            </>
        ) : (
            "Needs your answer below"
        )
    } else if (ended) {
        sentence = "The question went unanswered"
        state = "responded"
    } else if (settled === "declined" || settled === "cancelled") {
        sentence = "You declined to answer"
        state = "denied"
    } else if (settled === "degraded") {
        sentence = "The question could not be shown"
        state = "not-handled"
    } else {
        sentence = count ? (
            <>
                You answered{" "}
                <strong className="font-medium">
                    {count} {count === 1 ? "question" : "questions"}
                </strong>
            </>
        ) : (
            "You answered"
        )
    }

    const expandable = count > 0
    const header = (
        <>
            <ActivityNode icon="ask" state={state} yourTurn={settled === "pending"} />
            <span className="min-w-0 truncate text-sm text-colorText transition-colors group-hover:text-colorTextSecondary">
                {sentence}
            </span>
            {expandable ? (
                <CaretDown
                    size={9}
                    weight="bold"
                    className={`shrink-0 text-colorTextDisabled transition-transform ${
                        open ? "rotate-180" : ""
                    }`}
                />
            ) : null}
        </>
    )

    return (
        <div className="flex min-w-0 flex-col gap-2">
            {expandable ? (
                <button
                    type="button"
                    onClick={() => setOpen((v) => !v)}
                    aria-expanded={open}
                    className="relative -ml-1.5 flex w-fit max-w-full min-w-0 cursor-pointer items-center gap-3.5 rounded-md border-0 bg-transparent px-1.5 py-0.5 text-left group after:absolute after:-inset-y-2 after:inset-x-0 after:content-['']"
                >
                    {header}
                </button>
            ) : (
                <div className="flex min-w-0 items-center gap-3.5 py-0.5">{header}</div>
            )}
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
