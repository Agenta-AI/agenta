import {detectFileActivity, type FileActivity} from "@agenta/entities/session"
import {canonicalClientToolName} from "@agenta/shared/clientTools"
import type {ReasoningUIPart, TextUIPart, ToolUIPart} from "ai"

import {isExplainedByMcpNotice, mcpToolServerName, type McpServerNotice} from "./mcpServerNotice"
import {partToolName} from "./parts"
import type {RenderItem} from "./renderModel"
import {isNonFinalRunnerError, isSettled} from "./toolSummary"

// The activity fold's steps: reasoning and between-call text are thoughts, each call a tool step.
export type ActivityStep =
    | {
          kind: "thought"
          key: string
          text: string
          streaming: boolean
          /** Model reasoning, or text it wrote between steps. */
          source: "reasoning" | "text"
      }
    /** A browser-fulfilled tool (a connect, a question): the host renders its widget in place. */
    | {kind: "client"; key: string; part: ToolUIPart}
    | {
          kind: "tool"
          key: string
          part: ToolUIPart
          /** Files this step wrote — several consecutive writes fold into one step. */
          files: FileActivity[]
      }

export interface ActivitySplit {
    steps: ActivityStep[]
    /** The turn's answer, when its last text item is the last thing in the turn. */
    answer: TextUIPart | null
    /** Position in `items` of the answer, so a caller can key it the way it keys the others. */
    answerIndex: number
}

/** A call that ran and failed. Hidden from the fold by product rule; it stays in the parts. */
export const hasFailed = (part: ToolUIPart): boolean =>
    (part.state as string) === "output-error" &&
    !isNonFinalRunnerError((part as {errorText?: string}).errorText)

/** Housekeeping the reader sees elsewhere (the tab title, the agent name), not work worth a step. */
const HOUSEKEEPING = new Set(["rename_session", "rename_agent"])

/**
 * An MCP call whose failure nothing else on this turn accounts for.
 *
 * A failed call is normally kept out of the fold: the agent usually retries and recovers, and a red
 * row for a failure it handled is noise. An MCP call against a server that never joined is the one
 * failure it cannot recover from, and the notice card is what explains those — so when a notice for
 * that connection IS on the turn, the call stays hidden and the card speaks for it, and when none
 * is, hiding the call leaves the reader with nothing at all on the turn. That is the state a
 * disconnected connection produced: no notice, no row, no error text (round 6e).
 *
 * Scoped to MCP deliberately. Main's rule for every other failed call is untouched.
 */
const unexplainedMcpFailure = (part: ToolUIPart, notices: readonly McpServerNotice[]): boolean => {
    const wireName = partToolName(part)
    if (!mcpToolServerName(wireName)) return false
    return !isExplainedByMcpNotice(wireName, notices)
}

/** Whether a call is kept out of the fold. It stays in the parts and in the trace. */
export const hiddenFromFold = (
    part: ToolUIPart,
    notices: readonly McpServerNotice[] = [],
): boolean =>
    (hasFailed(part) && !unexplainedMcpFailure(part, notices)) ||
    HOUSEKEEPING.has(canonicalClientToolName(partToolName(part)).toLowerCase())

const fileWritten = (part: ToolUIPart): FileActivity | null => {
    if ((part.state as string) !== "output-available") return null
    const activity = detectFileActivity(partToolName(part), (part as {input?: unknown}).input)
    return activity && activity.op !== "delete" ? activity : null
}

/** Last write per path wins, so a write then an edit reads as one file. */
const dedupeByPath = (files: FileActivity[]): FileActivity[] => {
    const byPath = new Map<string, FileActivity>()
    for (const file of files) byPath.set(file.path, file)
    return [...byPath.values()]
}

/** The notices this turn carries, whichever message of the run they arrived in. */
const noticesOf = (items: RenderItem[]): McpServerNotice[] =>
    items.flatMap((item) => (item.kind === "mcpNotice" ? [item.notice] : []))

const isFoldable = (item: RenderItem): boolean =>
    item.kind === "tools" ||
    item.kind === "clientTool" ||
    (item.kind === "part" && (item.part.type === "reasoning" || item.part.type === "text"))

/** Whether the fold would show anything of this item. */
const showsInFold = (item: RenderItem, notices: readonly McpServerNotice[] = []): boolean =>
    item.kind === "tools"
        ? item.parts.some((part) => !hiddenFromFold(part, notices))
        : isFoldable(item)

/** Position of the trailing text — the candidate answer — or -1 when something the fold shows follows it. */
const trailingText = (items: RenderItem[], notices: readonly McpServerNotice[] = []): number => {
    for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i]
        if (item.kind === "part" && item.part.type === "text") return i
        if (showsInFold(item, notices)) return -1
    }
    return -1
}

const textState = (items: RenderItem[], i: number): string | undefined =>
    ((items[i] as {part: {state?: string}}).part as {state?: string}).state

const findAnswer = (
    items: RenderItem[],
    holdClosedText: boolean,
    notices: readonly McpServerNotice[] = [],
): number => {
    const i = trailingText(items, notices)
    if (i < 0 || textState(items, i) === "streaming" || holdClosedText) return -1
    const text = ((items[i] as {part: TextUIPart}).part.text ?? "").trim()
    return text ? i : -1
}

/** Whether the turn ends on a text no longer being written: the candidate answer. */
export const endsOnClosedText = (items: RenderItem[]): boolean => {
    const i = trailingText(items, noticesOf(items))
    return i >= 0 && textState(items, i) !== "streaming"
}

export interface SplitTurnActivityOptions {
    /** Keep a just-closed text in the fold: the call that makes it an aside lands a beat later. */
    holdClosedText?: boolean
}

export const splitTurnActivity = (
    items: RenderItem[],
    {holdClosedText = false}: SplitTurnActivityOptions = {},
): ActivitySplit => {
    // Read from the turn's own items: a notice can sit in a different message of the same run, so
    // the call it explains is not always beside it by the time the run is merged.
    const notices = noticesOf(items)
    const answerIndex = findAnswer(items, holdClosedText, notices)
    const steps: ActivityStep[] = []
    // Keyed by ordinal, not raw part position: the stream shuffles positions as it folds messages.
    let thoughts = 0
    items.forEach((item, position) => {
        if (position === answerIndex || !isFoldable(item)) return
        if (item.kind === "part") {
            const part = item.part as ReasoningUIPart | TextUIPart
            const text = part.text ?? ""
            if (!text.trim()) return
            steps.push({
                kind: "thought",
                key: `thought-${thoughts++}`,
                text,
                streaming: (part as {state?: string}).state === "streaming",
                source: part.type === "reasoning" ? "reasoning" : "text",
            })
            return
        }
        if (item.kind === "clientTool") {
            steps.push({
                kind: "client",
                key: item.part.toolCallId ?? `client-${item.index}`,
                part: item.part,
            })
            return
        }
        if (item.kind !== "tools") return
        item.parts.forEach((part, n) => {
            if (hiddenFromFold(part, notices)) return
            const file = fileWritten(part)
            const last = steps[steps.length - 1]
            // A run of writes reads as one step: "Wrote a.md and 3 others".
            if (file && last?.kind === "tool" && last.files.length) {
                last.files = dedupeByPath([...last.files, file])
                return
            }
            steps.push({
                kind: "tool",
                key: part.toolCallId ?? `tool-${item.index}-${n}`,
                part,
                files: file ? [file] : [],
            })
        })
    })
    return {
        steps,
        answer: answerIndex >= 0 ? ((items[answerIndex] as {part: TextUIPart}).part ?? null) : null,
        answerIndex,
    }
}

/** Files the whole fold wrote, for the collapsed line's outcome. */
export const activityFiles = (steps: ActivityStep[]): FileActivity[] =>
    dedupeByPath(steps.flatMap((step) => (step.kind === "tool" ? step.files : [])))

/** The step still in flight, if any; a client step is the reader's move and never counts. */
export const currentStep = (steps: ActivityStep[]): ActivityStep | null => {
    for (let i = steps.length - 1; i >= 0; i--) {
        const step = steps[i]
        if (step.kind === "client") continue
        if (step.kind === "thought" ? step.streaming : !isSettled(step.part.state as string))
            return step
    }
    return null
}

/** Whether any step is still in flight. A gate awaiting the user counts: the run is not done. */
export const hasLiveStep = (steps: ActivityStep[]): boolean => currentStep(steps) !== null
