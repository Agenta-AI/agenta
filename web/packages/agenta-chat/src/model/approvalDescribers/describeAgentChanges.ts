/**
 * Plain-English copy for `create_agent` and `edit_agent_config`: the agent tools that write to an
 * agent OTHER than the one in this chat. Each card names that agent, then lists the operations the
 * way the `commit_revision` card lists them.
 *
 * The call names its target by the slug or id the model passed, so that is what the card shows
 * until a result names it: the settled row reads the agent's name off the tool result.
 */
import {asRecord, formatCount, tryParseAsObject} from "@agenta/shared/utils"

import type {ApprovalPreview} from "../../skin/types"

import {describeOperationItems} from "./describeCommitRevision"

const stringField = (value: unknown, field: string): string | undefined => {
    const found = asRecord(value)?.[field]
    return typeof found === "string" && found.trim() ? found.trim() : undefined
}

const changes = (count: number) => formatCount(count, "change")

/** A tool result, which reaches the chat either parsed or still JSON-encoded. */
export const toolOutputRecord = (output: unknown): Record<string, unknown> | null =>
    asRecord(output) ?? (typeof output === "string" ? tryParseAsObject(output) : null)

/**
 * The agent a call is about: the name the result reports, else the name `create_agent` was given,
 * else the slug or id the model sent.
 */
export const agentCallTarget = (input: unknown, output?: unknown): string | undefined =>
    stringField(toolOutputRecord(output)?.agent, "name") ??
    stringField(input, "name") ??
    stringField(input, "agent")

export const describeEditAgentConfig = (input: unknown): ApprovalPreview | null => {
    const agent = agentCallTarget(input)
    if (!agent) return null
    const items = describeOperationItems(asRecord(input)?.operations)
    return {
        sentence: `Save ${changes(items.length)} to the agent ${agent}. Agenta saves this as a new version of that agent and does not deploy it.`,
        items,
    }
}

export const describeCreateAgent = (input: unknown): ApprovalPreview | null => {
    const name = stringField(input, "name")
    if (!name) return null
    const items = describeOperationItems(asRecord(input)?.operations)
    return {
        sentence: items.length
            ? `Create the agent ${name} from the default setup, with ${changes(items.length)}.`
            : `Create the agent ${name} from the default setup.`,
        items,
    }
}

/** The settled row's one-liner: the agent's name, then what changed. */
export const summarizeAgentCall = (input: unknown, output: unknown): string | null => {
    const agent = agentCallTarget(input, output)
    if (!agent) return null
    const titles = describeOperationItems(asRecord(input)?.operations).map((item) => item.title)
    return titles.length ? `${agent}: ${titles.join("; ")}` : agent
}
