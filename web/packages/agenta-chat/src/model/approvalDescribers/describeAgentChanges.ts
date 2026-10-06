/**
 * Plain-English copy for `create_agent` and `edit_agent_config`: the agent tools that write to an
 * agent OTHER than the one in this chat. Each card names that agent, then lists the operations the
 * way the `commit_revision` card lists them.
 *
 * The call names its target by the slug or id the model passed, so that is what the card shows
 * until a result names it: the settled row reads the agent's name off the tool result.
 */
import type {ApprovalPreview} from "../../skin/types"

import {describeOperationItems} from "./describeCommitRevision"

const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value && typeof value === "object" && !Array.isArray(value))

const stringField = (value: unknown, field: string): string | undefined => {
    if (!isRecord(value)) return undefined
    const found = value[field]
    return typeof found === "string" && found.trim() ? found.trim() : undefined
}

const changes = (count: number) => `${count} ${count === 1 ? "change" : "changes"}`

/** A tool result, which reaches the chat either parsed or still JSON-encoded. */
const outputRecord = (output: unknown): Record<string, unknown> | undefined => {
    if (isRecord(output)) return output
    if (typeof output !== "string" || !output.trim().startsWith("{")) return undefined
    try {
        const parsed: unknown = JSON.parse(output)
        return isRecord(parsed) ? parsed : undefined
    } catch {
        return undefined
    }
}

/**
 * The agent a call is about: the name the result reports, else the name `create_agent` was given,
 * else the slug or id the model sent.
 */
export const agentCallTarget = (input: unknown, output?: unknown): string | undefined =>
    stringField(outputRecord(output)?.agent, "name") ??
    stringField(input, "name") ??
    stringField(input, "agent")

export const describeEditAgentConfig = (input: unknown): ApprovalPreview | null => {
    const agent = agentCallTarget(input)
    if (!agent) return null
    const items = describeOperationItems(isRecord(input) ? input.operations : undefined)
    return {
        sentence: `Save ${changes(items.length)} to the agent ${agent}. Agenta saves this as a new version of that agent and does not deploy it.`,
        items,
    }
}

export const describeCreateAgent = (input: unknown): ApprovalPreview | null => {
    const name = stringField(input, "name")
    if (!name) return null
    const items = describeOperationItems(isRecord(input) ? input.operations : undefined)
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
    const titles = describeOperationItems(isRecord(input) ? input.operations : undefined).map(
        (item) => item.title,
    )
    return titles.length ? `${agent}: ${titles.join("; ")}` : agent
}
