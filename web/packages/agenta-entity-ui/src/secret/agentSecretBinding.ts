import type {AgentSecretBinding} from "@agenta/entities/secret"

/**
 * The `sandbox.credentials[]` entry an attach writes. A "user" secret names no slug: each person
 * who runs the agent gives their own value (contract section 5.1).
 */
export const agentSecretBinding = ({
    secretSlug,
    accountSource,
    envVar,
}: {
    secretSlug: string
    accountSource?: "user"
    envVar: string
}): AgentSecretBinding => ({
    secret: accountSource === "user" ? {account_source: "user"} : {slug: secretSlug},
    binding: {type: "env", name: envVar},
})
