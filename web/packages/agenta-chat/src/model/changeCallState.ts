/**
 * The state of one change call after the person answers (task 26.1): one function from the
 * interaction status (the tool part's state and the answer) and the result `status`. The card
 * and the result rows read it; there is no second state enum.
 *
 * A change call is a tool that saves a version of an agent: `edit_agent_config` and
 * `create_agent` in the builder chat, `commit_revision` in an agent's own chat.
 */
import {canonicalClientToolName} from "@agenta/shared/clientTools"
import {asRecord, tryParseAsObject} from "@agenta/shared/utils"
import type {ToolUIPart} from "ai"

import {unwrapToolUseError} from "../assets/toolFormat"

import {isToolPart, partToolName} from "./parts"
import {isNonFinalRunnerError} from "./toolSummary"

/** The tools whose approval card is a change card and whose answer ends in a result row. */
const CHANGE_TOOLS = new Set(["edit_agent_config", "create_agent", "commit_revision"])

export const isChangeTool = (toolName: string): boolean =>
    CHANGE_TOOLS.has(canonicalClientToolName(toolName))

/** Why a call saved nothing, in the words the row uses. */
export type NotSavedReason =
    /** Someone saved a newer version after the builder read the agent. */
    | "conflict"
    /** The person may not edit the agent. */
    | "access_denied"
    /** The new configuration cannot run. */
    | "invalid_configuration"
    /** The agent already had these values. */
    | "no_change"
    | "failed"

export type ChangeCallState =
    /** The card waits for the answer. */
    | {kind: "pending"}
    /** The card waits, and this reader cannot answer it. */
    | {kind: "read_only"}
    /** The answer is saved; the tool result has not arrived. */
    | {kind: "waiting"}
    | {kind: "saved"; version?: string; revisionId?: string; workflowId?: string}
    | {kind: "denied"}
    | {kind: "not_saved"; reason: NotSavedReason}

/** The interaction status and the result of one call, as the hosts know them. */
export interface ChangeCallInput {
    /** The tool part's state (`approval-requested`, `output-available`, ...). */
    partState?: string
    /** The person's answer, when the part records it. */
    approved?: boolean
    output?: unknown
    errorText?: string
    /** The answer is accepted and the records have not caught up yet (the dock knows this). */
    answered?: boolean
    /** The reader can read the chat but not send to it. */
    readOnly?: boolean
}

/** A tool result, which reaches the chat either parsed or still JSON-encoded. */
export const toolOutputRecord = (output: unknown): Record<string, unknown> | null =>
    asRecord(output) ?? (typeof output === "string" ? tryParseAsObject(output) : null)

/**
 * The code of the refusal envelope (`{code, message, next_step}`) a failed call carries. The
 * runner writes the reason line, then the envelope as JSON on the next line; a harness may wrap
 * both.
 */
const toolRefusalCode = (errorText: string | undefined): string | undefined => {
    if (!errorText) return undefined
    const text = unwrapToolUseError(errorText)
    const starts = [text.startsWith("{") ? 0 : -1]
    for (let at = text.indexOf("\n{"); at !== -1; at = text.indexOf("\n{", at + 1)) {
        starts.push(at + 1)
    }
    for (const start of starts) {
        if (start < 0) continue
        const code = tryParseAsObject(text.slice(start).trim())?.code
        if (typeof code === "string" && code) return code
    }
    return undefined
}

const reasonOf = (code: string | undefined): NotSavedReason => {
    if (code === "revision_conflict") return "conflict"
    if (code === "access_denied") return "access_denied"
    // The checks of the configuration itself; `invalid_arguments` is the model's own mistake.
    if (code?.startsWith("invalid_agent_") || code === "invalid_harness_kind")
        return "invalid_configuration"
    return "failed"
}

const stringOf = (value: unknown): string | undefined =>
    typeof value === "string" && value
        ? value
        : typeof value === "number"
          ? String(value)
          : undefined

/** What a result says was saved: `revision` (builder tools) or `workflow_revision` (commit). */
const savedOf = (result: Record<string, unknown>): Extract<ChangeCallState, {kind: "saved"}> => {
    const revision = asRecord(result.revision) ?? asRecord(result.workflow_revision)
    const version = stringOf(revision?.version)
    const revisionId = stringOf(revision?.id)
    const workflowId = stringOf(asRecord(result.agent)?.id) ?? stringOf(revision?.workflow_id)
    return {
        kind: "saved",
        ...(version ? {version} : {}),
        ...(revisionId ? {revisionId} : {}),
        ...(workflowId ? {workflowId} : {}),
    }
}

export const changeCallState = (status: ChangeCallInput): ChangeCallState => {
    const {partState: state, approved} = status
    if (state === "output-denied" || approved === false) return {kind: "denied"}
    if (state === "output-error") {
        // A call the runner runs later is not a result yet.
        if (isNonFinalRunnerError(status.errorText)) return {kind: "waiting"}
        return {kind: "not_saved", reason: reasonOf(toolRefusalCode(status.errorText))}
    }
    if (state === "output-available") {
        const result = toolOutputRecord(status.output)
        const outcome = result?.status
        if (outcome === "committed" || outcome === "created") return savedOf(result!)
        if (outcome === "no_change") return {kind: "not_saved", reason: "no_change"}
        return {kind: "not_saved", reason: "failed"}
    }
    if (status.answered || state === "approval-responded" || approved === true) {
        return {kind: "waiting"}
    }
    return status.readOnly ? {kind: "read_only"} : {kind: "pending"}
}

/** One change call of a message, with what its result row needs. */
export interface ChangeCall {
    toolCallId: string
    toolName: string
    input: unknown
    state: ChangeCallState
    /** The revision the call changed: what Revert goes back to. `create_agent` has none. */
    baseRevisionId?: string
}

/** The base a call names: `base_revision_id`, or the commit's own for `commit_revision`. */
const baseRevisionOf = (input: unknown): string | undefined => {
    const args = toolOutputRecord(input)
    return (
        stringOf(args?.base_revision_id) ??
        stringOf(asRecord(args?.workflow_revision)?.base_revision_id)
    )
}

/** The state of a tool part, from its own fields. */
export const changeCallStateOfPart = (
    part: ToolUIPart,
    options: {readOnly?: boolean} = {},
): ChangeCallState => {
    const approved = (part as {approval?: {approved?: boolean}}).approval?.approved
    return changeCallState({
        partState: part.state as string,
        ...(typeof approved === "boolean" ? {approved} : {}),
        output: (part as {output?: unknown}).output,
        errorText: (part as {errorText?: string}).errorText,
        readOnly: options.readOnly,
    })
}

/**
 * The change calls of a message that had an approval and are past it, in message order. A call
 * that still waits for its answer is the dock's; it has no row yet.
 */
export const answeredChangeCalls = (
    parts: readonly unknown[] = [],
    options: {finished?: boolean} = {},
): ChangeCall[] => {
    const calls: ChangeCall[] = []
    for (const raw of parts) {
        const part = raw as ToolUIPart
        if (!isToolPart(part?.type as string)) continue
        const toolName = partToolName(part)
        if (!isChangeTool(toolName)) continue
        // A call that never asked (an "allow" permission) shows as a step only.
        const asked =
            (part as {approval?: unknown}).approval !== undefined ||
            (part.state as string) === "output-denied"
        if (!asked) continue
        const state = changeCallStateOfPart(part)
        if (state.kind === "pending" || state.kind === "read_only") continue
        // A turn that ended with no result for the call will not get one: no row, rather than
        // a row that waits forever (the step still says what the person answered).
        if (state.kind === "waiting" && options.finished) continue
        const baseRevisionId = baseRevisionOf(part.input)
        calls.push({
            toolCallId: part.toolCallId ?? "",
            toolName,
            input: part.input,
            state,
            ...(baseRevisionId ? {baseRevisionId} : {}),
        })
    }
    return calls
}
