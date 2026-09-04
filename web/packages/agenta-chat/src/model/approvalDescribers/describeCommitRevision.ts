/**
 * Plain-English copy for a `commit_revision` gate.
 *
 * Nothing here shows the payload, a diff, or a digest. Each requested operation becomes one row
 * that says what the change MEANS — "New skill · deslope / Softens statements that read as too
 * intense" — and a verb whose value cannot be read that way falls back to the operation label plus
 * a clamped preview. It never infers a result: the backend's change-set engine owns that, and a
 * card that confidently states the wrong outcome is worse than one that states less.
 */
import {parseGatewayToolName} from "@agenta/entities/workflow/commitDiff"

import type {ApprovalPreview, ApprovalPreviewItem} from "../../skin/types"

import {asSentence, oneLine} from "./approvalText"
import {parseApprovedContentManifest} from "./approvedContentManifest"
import {
    operationLabel,
    parseRevisionOperations,
    readableTarget,
    type RevisionOperationPreview,
} from "./operationsPreview"

const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value && typeof value === "object" && !Array.isArray(value))

const stringField = (value: unknown, field: string): string | undefined => {
    if (!isRecord(value)) return undefined
    const found = value[field]
    return typeof found === "string" && found.trim() ? found : undefined
}

/**
 * Third-person present of a leading imperative verb: `Search` → `Searches`, `Copy` → `Copies`.
 * Gateway actions are `VERB_OBJECT` by convention, so this only ever conjugates the first word.
 */
const thirdPerson = (verb: string): string => {
    if (/(?:s|x|z|sh|ch|o)$/i.test(verb)) return `${verb}es`
    if (/[^aeiou]y$/i.test(verb)) return `${verb.slice(0, -1)}ies`
    return `${verb}s`
}

/**
 * What a gateway tool actually does, from the `{integration, action}` the commit carries. Built
 * through `parseGatewayToolName` — the same humanizer the transcript rows and commit summary use —
 * so the same tool is worded identically wherever it appears.
 */
const gatewayDetail = (value: unknown): string | undefined => {
    if (!isRecord(value)) return undefined
    const action = typeof value.action === "string" ? value.action : undefined
    const integration = typeof value.integration === "string" ? value.integration : undefined
    if (!action) return undefined
    const {label, source} = parseGatewayToolName(
        `tools__${value.provider ?? "gateway"}__${integration ?? "gateway"}__${action}`,
    )
    const [verb, ...rest] = label.split(" ")
    const phrase = [thirdPerson(verb), ...rest].join(" ")
    return asSentence(source ? `${phrase} on ${source}` : phrase)
}

/** A row's explanation: the entry's own words first, then what a gateway tool does. */
const valueDetail = (value: unknown): string | undefined => {
    const description = stringField(value, "description")
    if (description) return asSentence(oneLine(description))
    return gatewayDetail(value)
}

/** The list a target addresses (`skills`, `tools`, `mcps`), or undefined for a plain field. */
const listOf = (targetLabel: string): string | undefined => targetLabel.split(" ")[0] || undefined

/** The field a row is about, without the sub-path: `instructions / agents_md` → `instructions`. */
const fieldName = (targetLabel: string): string => targetLabel.split(" / ")[0]

/** Singular noun for a list, so a row reads "New skill" and not "New skills". */
const SINGULAR: Record<string, string> = {
    skills: "skill",
    tools: "tool",
    mcps: "connected app",
    triggers: "trigger",
}

const describeOperation = (operation: RevisionOperationPreview): ApprovalPreviewItem => {
    const list = listOf(operation.targetLabel)
    const noun = list ? SINGULAR[list] : undefined
    const name = stringField(operation.value, "name") ?? operation.selectorKey
    const detail = valueDetail(operation.value)

    switch (operation.operation) {
        case "add_item":
            if (noun && name) {
                return {title: `New ${noun} · ${name}`, detail}
            }
            break
        case "remove_item":
            if (noun && name) {
                return {
                    title: `${noun[0].toUpperCase()}${noun.slice(1)} removed · ${name}`,
                    detail: "No longer available to the agent.",
                }
            }
            break
        case "replace_item":
            if (noun && name) {
                return {
                    title: `${noun[0].toUpperCase()}${noun.slice(1)} updated · ${name}`,
                    detail,
                }
            }
            break
        case "edit_text":
            return {
                title: `Edited ${fieldName(operation.targetLabel)}`,
                detail: operation.editCount
                    ? `${operation.editCount} ${operation.editCount === 1 ? "edit" : "edits"} to the existing text.`
                    : undefined,
            }
        case "set":
            if (operation.newText) {
                return {
                    title: `New ${fieldName(operation.targetLabel)}`,
                    detail: oneLine(operation.newText),
                }
            }
            break
        case "remove":
            return {title: `Removed ${fieldName(operation.targetLabel)}`}
        default:
            break
    }

    // Unknown verb, or a value this cannot read as prose. Say what was asked for, no more.
    const preview = operation.fromFile
        ? "Content comes from a file in your workspace."
        : operation.newText
          ? oneLine(operation.newText)
          : operation.valueJson
            ? oneLine(operation.valueJson)
            : undefined
    return {
        title: `${operationLabel(operation.operation)} ${operation.targetLabel}`,
        detail: preview,
    }
}

/**
 * Legacy `{set, remove}` deltas — still reachable (the SDK keeps them behind
 * `ORDERED_OPERATIONS_ENV`). There are no ordered operations to read, so each changed top-level
 * path becomes one generic row.
 */
const describeLegacyDelta = (delta: unknown): ApprovalPreviewItem[] => {
    if (!isRecord(delta)) return []
    const items: ApprovalPreviewItem[] = []
    const set = delta.set
    if (isRecord(set)) {
        const walk = (node: Record<string, unknown>, path: string[]) => {
            for (const [key, value] of Object.entries(node)) {
                const next = [...path, key]
                // Descend through the addressing scaffolding, then describe the leaf.
                if (isRecord(value) && next.length < 3) {
                    walk(value, next)
                    continue
                }
                items.push({
                    title: `Changed ${fieldName(readableTarget(next))}`,
                    detail:
                        typeof value === "string"
                            ? oneLine(value)
                            : oneLine(JSON.stringify(value ?? null)),
                })
            }
        }
        walk(set, [])
    }
    const remove = delta.remove
    if (Array.isArray(remove)) {
        for (const path of remove) {
            items.push({title: `Removed ${readableTarget(Array.isArray(path) ? path : [path])}`})
        }
    }
    return items
}

/** Rows for content the runner froze from the workspace — a path, said as a sentence. */
const describeManifest = (manifest: unknown): ApprovalPreviewItem[] => {
    const parsed = parseApprovedContentManifest(manifest)
    if (!parsed) return []
    const items: ApprovalPreviewItem[] = parsed.diffs.map((diff) => ({
        title: `Rewrote ${diff.targetField}`,
        detail: `${diff.addedLines} ${diff.addedLines === 1 ? "line" : "lines"} added, ${
            diff.removedLines
        } removed.`,
    }))
    for (const file of parsed.files) {
        items.push({
            title: `From your workspace · ${file.relativePath}`,
            detail: "The agent read this file and is saving its contents.",
        })
    }
    return items
}

export const describeCommitRevision = (
    input: unknown,
    manifest: unknown,
): ApprovalPreview | null => {
    const commit =
        isRecord(input) && isRecord(input.workflow_revision) ? input.workflow_revision : null
    if (!commit) return null

    // The manifest holds the frozen bytes and the real diff for file-backed operations, so those
    // operations are described there — listing them here as well would state the same change twice.
    const manifestItems = describeManifest(manifest)
    const operations = parseRevisionOperations(commit.delta)
    const operationItems = operations
        ? operations.filter((op) => !(manifestItems.length && op.fromFile)).map(describeOperation)
        : describeLegacyDelta(commit.delta)
    const items = [...operationItems, ...manifestItems]
    if (!items.length) return null

    const count = items.length
    return {
        sentence: `Save ${count} ${count === 1 ? "change" : "changes"} to this agent. Agenta saves this as a new version, so nothing is overwritten.`,
        items,
    }
}
