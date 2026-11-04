import {
    CustomSecretFormat,
    isUserSecretBinding,
    type AgentSecretBinding,
    type NamedSecretRow,
} from "@agenta/entities/secret"

import {matchRequestedSecret} from "../secret"

export interface SecretDockRequest {
    name: string
    envVar: string
    reason: string
    /** The agent tried the configured value and it failed. */
    rejected: boolean
}

export type VaultRead = "checking" | "fresh" | "failed"

/** What the agent can already use for the requested variable. */
export type SecretDockSubject =
    | {kind: "checking"}
    /** Nothing saved: the value is the one thing left to give. */
    | {kind: "empty"}
    /** A saved secret fits the request and is not attached yet. */
    | {kind: "vault"; row: NamedSecretRow}
    /** `row` is the vault record behind it, unknown for a person's own secret or an unread vault. */
    | {kind: "attached"; index: number; binding: AgentSecretBinding; row?: NamedSecretRow}
    /** The attachment names a secret the vault no longer has, so a run would get no value. */
    | {kind: "missing"; index: number; binding: AgentSecretBinding}

export const parseSecretRequest = (input: unknown): SecretDockRequest | undefined => {
    const {name, env_var, reason, rejected} = (input ?? {}) as Record<string, unknown>
    if (typeof name !== "string" || typeof env_var !== "string" || typeof reason !== "string") {
        return undefined
    }
    return {name, envVar: env_var, reason, rejected: rejected === true}
}

export const resolveSecretDockSubject = ({
    request,
    bindings,
    secrets,
    vault,
}: {
    request: SecretDockRequest
    bindings: AgentSecretBinding[]
    secrets: NamedSecretRow[]
    vault: VaultRead
}): SecretDockSubject => {
    if (vault === "checking") return {kind: "checking"}
    const index = bindings.findIndex((item) => item.binding.name === request.envVar)
    if (index < 0) {
        const textSecrets = secrets.filter((row) => row.format === CustomSecretFormat.Text)
        const row = matchRequestedSecret(textSecrets, request)
        return row ? {kind: "vault", row} : {kind: "empty"}
    }
    const binding = bindings[index]
    if (isUserSecretBinding(binding) || vault === "failed") {
        return {kind: "attached", index, binding}
    }
    const row = secrets.find((candidate) => candidate.slug === binding.secret.slug)
    return row ? {kind: "attached", index, binding, row} : {kind: "missing", index, binding}
}

/** The record a new value overwrites in place. A JSON secret has no single value to replace. */
export const replaceableRow = (subject: SecretDockSubject): NamedSecretRow | undefined => {
    if (subject.kind !== "vault" && subject.kind !== "attached") return undefined
    return subject.row?.format === CustomSecretFormat.Text ? subject.row : undefined
}
