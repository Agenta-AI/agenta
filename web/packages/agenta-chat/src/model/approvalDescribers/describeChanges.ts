/**
 * The changes of a versioned agent change (`edit_agent_config`, `create_agent`) as card data.
 *
 * Old values come only from the server preview (the change-set engine's dry run on the call's
 * base revision). The browser never applies operations itself. Without a usable preview the card
 * shows the proposed values from the operations, and says so (`proposedValues`).
 */
import {asRecord} from "@agenta/shared/utils"

import type {
    ApprovalChange,
    ApprovalChangeDetail,
    ApprovalPreviewItem,
    ChangePreview,
    ChangePreviewChange,
} from "../../skin/types"

import {describeOperationItems} from "./describeCommitRevision"

const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value && typeof value === "object" && !Array.isArray(value))

/** The preview when it has the contract's shape; anything else counts as no preview. */
export const parseChangePreview = (value: unknown): ChangePreview | null => {
    const preview = asRecord(value)
    if (!preview || typeof preview.applies !== "boolean") return null
    if (!Array.isArray(preview.operations) || !Array.isArray(preview.changes)) return null
    return preview as unknown as ChangePreview
}

/** Addressing scaffolding at the start of a target; nothing to read. */
const SCAFFOLDING = new Set(["parameters", "agent"])

/** Readable path segments: `[..., {list: "skills", key: "qa"}, "body"]` → `["skills", "qa", "body"]`. */
export const changePath = (target: unknown[]): string[] => {
    const path: string[] = []
    for (const segment of target) {
        if (typeof segment === "string") {
            if (path.length === 0 && SCAFFOLDING.has(segment)) continue
            path.push(segment)
        } else if (isRecord(segment)) {
            const list = segment.list ?? segment.field
            const key = segment.key ?? segment.name
            if (typeof list === "string" && path[path.length - 1] !== list) path.push(list)
            if (typeof key === "string") path.push(key)
        }
    }
    return path
}

/** A value as text to show: strings as they are, anything else as indented JSON. */
const displayValue = (value: unknown): string | undefined => {
    if (value === undefined) return undefined
    if (typeof value === "string") return value
    try {
        return JSON.stringify(value, null, 2)
    } catch {
        return String(value)
    }
}

/** A text that reads as a document (instructions, a skill body), not as a short value. */
const isLongText = (value: unknown): value is string =>
    typeof value === "string" && (value.includes("\n") || value.length > 120)

/** The name of the item a path ends on, or an item value names. */
const itemName = (path: string[], value: unknown): string =>
    (isRecord(value) && typeof value.name === "string" && value.name) || path[path.length - 1] || ""

const previewDetail = (
    change: ChangePreviewChange,
    path: string[],
): ApprovalChangeDetail | undefined => {
    if (change.kind === "added")
        return {
            kind: "item",
            mode: "added",
            name: itemName(path, change.new),
            value: displayValue(change.new),
        }
    if (change.kind === "removed")
        return {
            kind: "item",
            mode: "removed",
            name: itemName(path, change.old),
            value: displayValue(change.old),
        }
    // A change past the size bound keeps only its path: title and path, no values.
    if (change.old === undefined && change.new === undefined && !change.diff) return undefined
    if (change.diff || isLongText(change.old) || isLongText(change.new))
        return {
            kind: "text_diff",
            old: displayValue(change.old),
            new: displayValue(change.new),
            ...(change.diff ? {diff: change.diff} : {}),
        }
    return {kind: "value_change", old: displayValue(change.old), new: displayValue(change.new)}
}

/** The proposed values of one operation, read from the call's arguments. */
const operationDetail = (
    operation: Record<string, unknown>,
    path: string[],
): ApprovalChangeDetail | undefined => {
    const value = operation.value
    switch (operation.operation) {
        case "set":
            if (value === undefined) return undefined
            return isLongText(value)
                ? {kind: "text_diff", new: value, fragmentsOnly: true}
                : {kind: "value_change", new: displayValue(value)}
        case "edit_text": {
            const edits = Array.isArray(operation.edits)
                ? operation.edits.filter(isRecord).map((edit) => ({
                      ...(typeof edit.old_text === "string" ? {old: edit.old_text} : {}),
                      ...(typeof edit.new_text === "string" ? {new: edit.new_text} : {}),
                  }))
                : []
            return {kind: "text_diff", fragmentsOnly: true, edits}
        }
        case "add_item":
            return {
                kind: "item",
                mode: "added",
                name: itemName(path, value),
                value: displayValue(value),
            }
        case "remove_item":
            return {kind: "item", mode: "removed", name: itemName(path, undefined)}
        default:
            return undefined
    }
}

const titleOf = (titles: ApprovalPreviewItem[], indexes: number[], path: string[]): string =>
    titles[indexes[0] ?? -1]?.title ?? (path.join(" › ") || "Configuration")

export interface DescribedChanges {
    changes: ApprovalChange[]
    proposedValues: boolean
    refusal?: string
}

/**
 * The changes of a call with ordered `operations`. With a preview that applies, one change per
 * changed path, with its old and new values. Without one (or when it cannot apply), one change
 * per operation with the proposed values; an operation the preview names as failing carries its
 * error. A pure function: no fetch, no revision read.
 */
export const describeConfigChanges = (
    operations: unknown,
    changePreview?: unknown,
): DescribedChanges => {
    const ops = Array.isArray(operations) ? operations.filter(isRecord) : []
    const titles = describeOperationItems(ops)
    const preview = parseChangePreview(changePreview)
    const base = {effect: "version" as const, risks: []}

    if (preview?.applies) {
        const changes = preview.changes.map((change): ApprovalChange => {
            const path = changePath(Array.isArray(change.path) ? change.path : [])
            const detail = previewDetail(change, path)
            return {
                title: titleOf(titles, change.operation_indexes ?? [], path),
                path,
                ...(detail ? {detail} : {}),
                ...base,
            }
        })
        return {changes, proposedValues: false}
    }

    const errors = new Map(
        (preview?.operations ?? [])
            .filter((status) => status.applies === false && status.error)
            .map((status) => [status.index, status.error!.message]),
    )
    const changes = ops.map((operation, index): ApprovalChange => {
        const path = changePath(Array.isArray(operation.target) ? operation.target : [])
        const detail = operationDetail(operation, path)
        const error = errors.get(index)
        return {
            title: titleOf(titles, [index], path),
            path,
            ...(detail ? {detail} : {}),
            ...base,
            ...(error ? {error} : {}),
        }
    })
    return {
        changes,
        proposedValues: true,
        ...(preview?.error ? {refusal: preview.error.message} : {}),
    }
}
