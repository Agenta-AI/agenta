import {useEffect, useId, useState} from "react"

import {RevealCollapse, ToolIOBlock} from "@agenta/chat/components"
import {
    approvalVerdictText,
    isNonFinalRunnerError,
    isNotHandledOutput,
    partSentence,
    partToolName,
    rowSummary,
} from "@agenta/chat/model"
import {resolveToolDisplay} from "@agenta/chat/skin"
import {expandedValueAtomFamily, setExpandedAtom, toolRowKey} from "@agenta/chat/state"
import type {ToolUIPart} from "ai"
import {useAtomValue, useSetAtom} from "jotai"
import {
    Ban,
    CheckCircle2,
    ChevronRight,
    CircleDashed,
    Clock,
    Info,
    Wrench,
    XCircle,
} from "lucide-react"

/**
 * One tool call: the desktop ToolActivity row, in touch sizing — status glyph + humanised sentence
 * + summary, expanding in place to the call's raw name, arguments and result.
 *
 * The name stays the HUMANISED sentence the shared resolver builds ("Reading a file"), never the
 * wire name: the desktop has read that way since the tool-activity work landed.
 */
export const ToolLine = ({part}: {part: ToolUIPart}) => {
    const state = part.state as string
    const input = (part as {input?: unknown}).input
    const output = (part as {output?: unknown}).output
    const errorText = (part as {errorText?: string}).errorText

    const awaiting = state === "approval-requested"
    const responded = state === "approval-responded"
    // A runner error that says the call never RAN is a note, not a failure — it never gets red.
    const deferred = state === "output-error" && isNonFinalRunnerError(errorText)
    const failed = state === "output-error" && !deferred
    const notHandled = state === "output-available" && isNotHandledOutput(output)

    const display = resolveToolDisplay(partToolName(part), input, undefined, output)
    const shownName = partSentence(part, display.activity)
    const summary = awaiting
        ? "Awaiting approval"
        : // Never claim an approval nobody can evidence: a replayed gate reads "responded".
          responded
          ? approvalVerdictText(part)
          : rowSummary(part)
    // Drop a summary the sentence already made: "Reading a file failed · failed" is one word twice.
    const midText =
        summary && shownName.toLowerCase().endsWith(summary.toLowerCase()) ? null : summary

    // Track presence explicitly: a legit `null` output is real, and `output-available` with no
    // `output` key must not open an empty expander.
    const hasInput = input !== undefined
    const hasOutput = state === "output-available" && output !== undefined
    const hasError = errorText !== undefined
    const expandable = hasInput || hasOutput || hasError

    // Persisted by tool-call id, so an expanded row survives its turn scrolling out and back.
    const rowKey = toolRowKey(part.toolCallId ?? display.raw)
    const stored = useAtomValue(expandedValueAtomFamily(rowKey))
    const setExpanded = useSetAtom(setExpandedAtom)
    const open = expandable && (stored ?? false)
    const panelId = useId()
    // Format a payload only once the reader opens it, and keep it mounted after so closing animates.
    const [everOpen, setEverOpen] = useState(open)
    useEffect(() => {
        if (open) setEverOpen(true)
    }, [open])

    const glyph = awaiting ? (
        <Wrench className="text-colorWarning size-3.5 shrink-0" />
    ) : state === "output-denied" || (responded && approvalVerdictText(part) === "denied") ? (
        <Ban className="text-colorTextTertiary size-3.5 shrink-0" />
    ) : deferred ? (
        <Clock className="text-colorTextTertiary size-3.5 shrink-0" />
    ) : failed ? (
        <XCircle className="text-colorError size-3.5 shrink-0" />
    ) : notHandled ? (
        <Info className="text-colorTextTertiary size-3.5 shrink-0" />
    ) : responded ? (
        <CheckCircle2 className="text-colorTextTertiary size-3.5 shrink-0" />
    ) : state === "output-available" ? (
        <CheckCircle2 className="text-colorSuccess size-3.5 shrink-0" />
    ) : (
        <CircleDashed className="text-colorTextTertiary size-3.5 shrink-0 motion-safe:animate-spin" />
    )

    const header = (
        <>
            <ChevronRight
                className={`text-colorTextTertiary size-3 shrink-0 transition-transform ${
                    expandable ? "" : "invisible"
                } ${open ? "rotate-90" : ""}`}
            />
            {glyph}
            {/* The sentence never yields, as on the desktop row: the detail and the status beside
                it absorb the squeeze. With `min-w-0` here instead, every child was equally
                shrinkable, so a long argument took the width and left "Listed files" as "Li…" on a
                phone. `max-w-full` caps a sentence wider than the row, and the row clips the rest. */}
            <span className="text-colorText max-w-full shrink-0 truncate font-medium">
                {shownName}
            </span>
            {display.detail ? (
                <span className="text-colorTextSecondary min-w-0 truncate font-mono">
                    {display.detail}
                </span>
            ) : null}
            {midText ? (
                <span
                    className={`min-w-0 truncate ${
                        failed ? "text-colorError" : "text-colorTextSecondary"
                    }`}
                >
                    {midText}
                </span>
            ) : null}
        </>
    )

    return (
        <div className="flex min-w-0 flex-col">
            {expandable ? (
                <button
                    type="button"
                    onClick={() => setExpanded({key: rowKey, value: !open})}
                    aria-expanded={open}
                    aria-controls={panelId}
                    // The `after` box is the ~44px touch target; the row's own chrome never grows.
                    className="relative flex min-w-0 items-center gap-2 overflow-hidden border-0 bg-transparent px-0 py-0.5 text-left text-xs after:absolute after:-inset-x-1 after:-inset-y-2 after:content-['']"
                >
                    {header}
                </button>
            ) : (
                <p className="m-0 flex min-w-0 items-center gap-2 overflow-hidden py-0.5 text-xs">
                    {header}
                </p>
            )}
            <RevealCollapse open={open}>
                <div id={panelId} className="mt-1 flex min-w-0 flex-col gap-1.5 pl-5">
                    {everOpen ? (
                        <>
                            <ToolIOBlock label="tool" value={display.raw} />
                            {hasInput ? <ToolIOBlock label="input" value={input} /> : null}
                            {hasError ? (
                                <ToolIOBlock
                                    label={deferred ? "note" : "error"}
                                    value={errorText}
                                    danger={!deferred}
                                />
                            ) : hasOutput ? (
                                <ToolIOBlock label="output" value={output} />
                            ) : null}
                        </>
                    ) : null}
                </div>
            </RevealCollapse>
        </div>
    )
}
