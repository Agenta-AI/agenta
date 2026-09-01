/**
 * What an approval gate SAYS, in plain language.
 *
 * The card shows one sentence and a short list of readable rows — never the payload, a diff, or a
 * digest — and it shows the same thing to everyone, in every mode. That is only possible if the
 * per-tool knowledge is DATA rather than a React body, so this module resolves a gate to an
 * {@link ApprovalPreview}: registered describer first, generic fallback second.
 *
 * The generic fallback is not a placeholder. Most gates are ordinary tool calls, and
 * `resolveToolDisplay` already turns a raw tool name and its arguments into a sentence the
 * transcript rows use; reusing it here keeps the card and the row saying the same thing.
 */
import {PATH_KEYS} from "@agenta/entities/session"

import {
    canonicalToolName,
    inSentence,
    resolveApprovalDescriber,
    resolveToolDisplay,
} from "../skin/registry"
import type {ApprovalPreview, ApprovalPreviewItem} from "../skin/types"

import {BUILTIN_APPROVAL_DESCRIBERS} from "./approvalDescribers"
import {
    asSentence,
    fieldLabel,
    fileTarget,
    oneLine,
    readableFieldRows,
} from "./approvalDescribers/approvalText"
import {summarizeApprovalInput} from "./approvalInputSummary"
import type {PendingApproval} from "./approvals"

export type {ApprovalPreview, ApprovalPreviewItem}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value && typeof value === "object" && !Array.isArray(value))

/**
 * Rows for a tool with no describer: one per readable top-level argument, labelled by its field
 * name. Nested objects are skipped rather than stringified — a row of JSON is exactly what this
 * card exists to remove, and no row at all is more honest than one saying `{…}`.
 */
const genericItems = (input: unknown): ApprovalPreviewItem[] => {
    if (typeof input === "string" && input.trim()) return [{title: "Input", detail: oneLine(input)}]
    if (!isRecord(input)) return []
    const items = readableFieldRows(input, {resolvePaths: true})
    if (items.length) return items
    // Nothing structured was readable — fall back to the payload's single primary field, if it
    // has one (a bash gate is its command, not a bag of arguments).
    const summary = summarizeApprovalInput(input)
    return summary.text && summary.label !== "Input"
        ? [{title: fieldLabel(summary.label), detail: oneLine(summary.text)}]
        : []
}

/** The path argument a file tool names, if it has one. */
const pathArgument = (input: unknown): string | undefined => {
    if (!isRecord(input)) return undefined
    for (const key of PATH_KEYS) {
        const value = input[key]
        if (typeof value === "string" && value.trim()) return value.trim()
    }
    return undefined
}

/**
 * Swap the generic object of a file activity for the file itself: "Reading a file" + `notes/a.md`
 * → "reading notes/a.md" (#6349). The ask is then complete without expanding the details.
 *
 * SINGULAR only, and that carries the whole rule. A tool that acts on one file ("Reading a file")
 * takes the path as its TARGET, so naming it is the ask; a tool that acts on many ("Listing files",
 * "Looking for files") takes the same argument as the SCOPE it searches, and "looking for src/" is
 * a claim about the wrong thing. An activity this shape does not match keeps its own wording.
 */
const namedFileActivity = (activity: string, input: unknown): string | undefined => {
    const generic = /^(.*?)\s+(?:an?|the)\s+file$/i.exec(activity)
    if (!generic?.[1]) return undefined
    const path = pathArgument(input)
    return path ? `${generic[1]} ${fileTarget(path)}` : undefined
}

/**
 * The preview for any tool without a describer: the humanized activity as the sentence, and the
 * payload's readable arguments as rows.
 */
const genericPreview = (approval: PendingApproval): ApprovalPreview => {
    const display = resolveToolDisplay(approval.toolName, approval.input)
    const source = display.source ? ` from ${display.source}` : ""
    const running =
        display.kind === "file"
            ? (namedFileActivity(display.activity.running, approval.input) ??
              display.activity.running)
            : display.activity.running
    return {
        sentence: asSentence(
            `The agent wants your approval before ${inSentence(running)}${source}`,
        ),
        items: genericItems(approval.input),
    }
}

/**
 * The plain-English copy for one gate. Never throws: a describer that fails falls back.
 *
 * `appName` is the catalog name for the preview's `sourceKey`, which answers late. The card
 * resolves once without it and calls again once it has one — same two-pass shape as
 * `resolveToolDisplay`.
 */
export const describeApproval = (approval: PendingApproval, appName?: string): ApprovalPreview => {
    // Canonical for the lookup: the same platform tool must resolve under every harness, so a
    // `mcp__agenta-tools__commit_revision` gate gets the commit describer too.
    const name = canonicalToolName(approval.toolName)
    const describer = resolveApprovalDescriber(name) ?? BUILTIN_APPROVAL_DESCRIBERS[name]
    if (describer) {
        try {
            const preview = describer(approval.input, approval.manifest, appName)
            if (preview) return preview
        } catch {
            // A describer that cannot read its own payload must not take the card down with it.
        }
    }
    return genericPreview(approval)
}

/**
 * One row per pending gate, for a turn that parked several at once. This is what makes
 * "Approve all" an informed click now that the batch peek is gone: the same toggle that shows a
 * single gate's changes shows the whole batch's actions.
 */
export const describeBatchItems = (approvals: PendingApproval[]): ApprovalPreviewItem[] =>
    approvals.map((approval) => {
        const display = resolveToolDisplay(approval.toolName, approval.input)
        return {
            title: display.activity.running || display.label,
            detail: describeApproval(approval).items[0]?.detail,
        }
    })
