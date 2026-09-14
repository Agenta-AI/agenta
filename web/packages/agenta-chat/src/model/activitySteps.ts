import {detectFileActivity, type FileActivity} from "@agenta/entities/session"
import {canonicalClientToolName} from "@agenta/shared/clientTools"
import type {ReasoningUIPart, TextUIPart, ToolUIPart} from "ai"

import {partToolName} from "./parts"
import type {RenderItem} from "./renderModel"
import {isNonFinalRunnerError, isSettled} from "./toolSummary"

/**
 * The activity fold's steps, derived from a turn's render items.
 *
 * A turn reads as one collapsed line ("Worked for 11s") over a timeline of what the agent did
 * before it answered. Reasoning and any text the model wrote BETWEEN tool calls are thought
 * steps; each tool call is a tool step. Only the last text item, when nothing follows it, is the
 * answer and stays out of the fold.
 */
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

/** Whether a call is kept out of the fold. It stays in the parts and in the trace. */
export const hiddenFromFold = (part: ToolUIPart): boolean =>
    hasFailed(part) || HOUSEKEEPING.has(canonicalClientToolName(partToolName(part)).toLowerCase())

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

const isFoldable = (item: RenderItem): boolean =>
    item.kind === "tools" ||
    item.kind === "clientTool" ||
    (item.kind === "part" && (item.part.type === "reasoning" || item.part.type === "text"))

/** Whether the fold would show anything of this item. A hidden call, a `step-start`, a `data-*`
 * sibling: none of these come between a text and its place as the answer. */
const showsInFold = (item: RenderItem): boolean =>
    item.kind === "tools" ? item.parts.some((part) => !hiddenFromFold(part)) : isFoldable(item)

/**
 * The last text item is the answer only when nothing the fold would show comes after it — and
 * only once it is written out. The runner closes a text (`text-end`) the moment it knows what
 * comes next, a tool call or the end of the run, so a text still open may yet turn out to be an
 * aside on the way to a call; it types in the fold until then and leaves it as the answer, not
 * the other way round.
 */
const findAnswer = (items: RenderItem[], holdClosedText: boolean): number => {
    for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i]
        if (item.kind === "part" && item.part.type === "text") {
            const state = (item.part as {state?: string}).state
            if (state === "streaming" || holdClosedText) return -1
            return (item.part.text ?? "").trim() ? i : -1
        }
        if (showsInFold(item)) return -1
    }
    return -1
}

/** Whether the turn ends on a text no longer being written — closed by the runner
 * (`text-end`), or already adopted from the record — the candidate answer the host holds for a
 * beat before it leaves the fold. */
export const endsOnClosedText = (items: RenderItem[]): boolean => {
    for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i]
        if (item.kind === "part" && item.part.type === "text") {
            return (item.part as {state?: string}).state !== "streaming"
        }
        if (showsInFold(item)) return false
    }
    return false
}

export interface SplitTurnActivityOptions {
    /** Keep a just-closed text in the fold a beat longer: the call that makes it an aside lands
     * a commit or two after its `text-end`, and the host holds the line until that beat passes. */
    holdClosedText?: boolean
}

export const splitTurnActivity = (
    items: RenderItem[],
    {holdClosedText = false}: SplitTurnActivityOptions = {},
): ActivitySplit => {
    const answerIndex = findAnswer(items, holdClosedText)
    const steps: ActivityStep[] = []
    items.forEach((item, position) => {
        if (position === answerIndex || !isFoldable(item)) return
        if (item.kind === "part") {
            const part = item.part as ReasoningUIPart | TextUIPart
            const text = part.text ?? ""
            if (!text.trim()) return
            steps.push({
                kind: "thought",
                key: `thought-${item.index}`,
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
            if (hiddenFromFold(part)) return
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

/** The step still in flight, if any — the one the collapsed line narrates. A client step is the
 * reader's move, not the agent's, so it never counts: the host says when the run is parked. */
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
