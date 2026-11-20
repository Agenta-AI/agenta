/** The agent's secret attachments (`sandbox.credentials`), read from its configuration. */
import type {AgentSecretBinding} from "@agenta/entities/secret"

const isBinding = (value: unknown): value is AgentSecretBinding => {
    if (!value || typeof value !== "object") return false
    const candidate = value as AgentSecretBinding
    return (
        (typeof candidate.secret?.slug === "string" ||
            candidate.secret?.account_source === "user") &&
        candidate.binding?.type === "env" &&
        typeof candidate.binding.name === "string"
    )
}

/** The well-formed attachments of `agent` (`parameters.agent`), in their saved order. */
export const readSecretBindings = (agent: Record<string, unknown>): AgentSecretBinding[] => {
    const sandbox = agent.sandbox
    const credentials =
        sandbox && typeof sandbox === "object"
            ? (sandbox as {credentials?: unknown}).credentials
            : undefined
    return Array.isArray(credentials) ? credentials.filter(isBinding) : []
}

/** The attachment that gives the agent `envVar`, with its place in the list. */
export const findSecretBinding = (
    bindings: AgentSecretBinding[],
    envVar: string,
): {index: number; value: AgentSecretBinding} | undefined => {
    const index = bindings.findIndex((binding) => binding.binding.name === envVar)
    return index < 0 ? undefined : {index, value: bindings[index]!}
}
