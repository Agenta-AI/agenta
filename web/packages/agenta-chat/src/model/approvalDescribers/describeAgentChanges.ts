/**
 * Plain-English copy for `create_agent` and `edit_agent_config`: the agent tools that write to an
 * agent OTHER than the one in this chat. Each card names that agent, then lists the operations the
 * way the `commit_revision` card lists them.
 *
 * The call names its target by the slug or id the model passed, so that is what the card shows
 * until a result names it: the settled row reads the agent's name off the tool result.
 */
import {createT} from "@agenta/i18n"
import chatChangeCardCatalog from "@agenta/i18n/catalogs/chat.changeCard"
import {asRecord, formatCount} from "@agenta/shared/utils"

import type {ApprovalPreview} from "../../skin/types"
import {changeCallState, toolOutputRecord} from "../changeCallState"

import {describeConfigChanges} from "./describeChanges"
import {describeOperationItems} from "./describeCommitRevision"

const tCard = createT(chatChangeCardCatalog)

const stringField = (value: unknown, field: string): string | undefined => {
    const found = asRecord(value)?.[field]
    return typeof found === "string" && found.trim() ? found.trim() : undefined
}

const changes = (count: number) => formatCount(count, "change")

/**
 * The agent a call is about: the name the result reports, else the name `create_agent` was given,
 * else the slug or id the model sent.
 */
export const agentCallTarget = (input: unknown, output?: unknown): string | undefined =>
    stringField(toolOutputRecord(output)?.agent, "name") ??
    stringField(input, "name") ??
    stringField(input, "agent")

export const describeEditAgentConfig = (
    input: unknown,
    _manifest?: unknown,
    _appName?: string,
    changePreview?: unknown,
): ApprovalPreview | null => {
    const agent = agentCallTarget(input)
    if (!agent) return null
    const operations = asRecord(input)?.operations
    const items = describeOperationItems(operations)
    const described = describeConfigChanges(operations, changePreview)
    // The preview names the revision it ran on; without one the call names it by id only.
    const baseRevisionId = stringField(input, "base_revision_id")
    const base = described.base ?? (baseRevisionId ? {revisionId: baseRevisionId} : undefined)
    return {
        sentence: `Save ${changes(items.length)} to the agent ${agent}. Agenta saves this as a new version of that agent and does not deploy it.`,
        items,
        agentName: agent,
        ...(described.changes.length || described.cannotApply
            ? {...described, ...(base ? {base} : {})}
            : {}),
    }
}

export const describeCreateAgent = (
    input: unknown,
    _manifest?: unknown,
    _appName?: string,
    changePreview?: unknown,
): ApprovalPreview | null => {
    const name = stringField(input, "name")
    if (!name) return null
    const items = describeOperationItems(asRecord(input)?.operations)
    const create = items.length
        ? `Create the agent ${name} from the default setup, with ${changes(items.length)}.`
        : `Create the agent ${name} from the default setup.`
    // `visibility` defaults to private on the server too.
    const audience =
        stringField(input, "visibility") === "project"
            ? "Everyone in this project will see it."
            : "Only you will see it."
    const described = describeConfigChanges(asRecord(input)?.operations, changePreview)
    // A new agent has no base version: the card has its own header and the sentence as detail.
    return {
        sentence: `${create} ${audience}`,
        items,
        agentName: name,
        header: {title: tCard("chat.changeCard.titleCreateAgent"), path: [name]},
        changes: described.changes,
        // Nothing to label when the new agent has no operations.
        proposedValues: described.proposedValues && described.changes.length > 0,
        cannotApply: described.cannotApply,
    }
}

/**
 * The version a saved result names (`committed`, or `created` for a new agent), from
 * `revision: {id, version}`; null for any other result (denied, refused, a conflict).
 */
export const savedVersion = (output: unknown): string | null => {
    const state = changeCallState({partState: "output-available", output})
    return state.kind === "saved" ? (state.version ?? null) : null
}

/** The settled row's one-liner: "Saved as vN" when the call saved, the agent's name, then what changed. */
export const summarizeAgentCall = (input: unknown, output: unknown): string | null => {
    const agent = agentCallTarget(input, output)
    if (!agent) return null
    const titles = describeOperationItems(asRecord(input)?.operations).map((item) => item.title)
    const line = titles.length ? `${agent}: ${titles.join("; ")}` : agent
    const version = savedVersion(output)
    return version ? `${tCard("chat.changeCard.savedAs", {version})} · ${line}` : line
}
