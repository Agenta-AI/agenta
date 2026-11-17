/** Pure rules shared by the attachment dialog and the request dock. */
import type {AgentSecretBinding, NamedSecretRow} from "@agenta/entities/secret"
import type {OwnerKind} from "@agenta/shared/types"
import {slugifyBase, toEnvVarName} from "@agenta/shared/utils"

export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

export interface AgentSecretRequestSeed {
    name: string
    envVar?: string
    reason?: string
}

type SecretOwner = Exclude<OwnerKind, "organization">

/** Why a variable name cannot be attached, or null. `editIndex` is the binding being renamed. */
export const envBindingError = (
    name: string,
    bindings: AgentSecretBinding[],
    editIndex?: number,
): string | null => {
    if (!ENV_NAME.test(name))
        return "Use letters, digits, and underscores; do not start with a digit."
    return bindings.some((item, index) => index !== editIndex && item.binding.name === name)
        ? "This environment variable is already attached."
        : null
}

/** Who may own a new secret, as on Settings; the first is the default. Absent: the project's. */
export const newSecretOwners = (
    personalAccountsOn: boolean,
    canCreateProjectSecret: boolean,
): SecretOwner[] | undefined => {
    if (!personalAccountsOn) return undefined
    return canCreateProjectSecret ? ["user", "project"] : ["user"]
}

/** The saved secret the agent most likely means: same env var, name, or slug as the request. */
export const matchRequestedSecret = <
    T extends Pick<NamedSecretRow, "name" | "slug" | "defaultEnvVar">,
>(
    secrets: T[],
    request?: AgentSecretRequestSeed,
): T | undefined => {
    if (!request) return undefined
    const name = request.name.trim().toLowerCase()
    const slug = slugifyBase(request.name)
    return (
        (request.envVar ? secrets.find((s) => s.defaultEnvVar === request.envVar) : undefined) ??
        secrets.find((s) => s.name?.trim().toLowerCase() === name) ??
        secrets.find((s) => !!slug && s.slug === slug)
    )
}

export const suggestedAgentSecretEnv = ({
    requestEnv,
    defaultEnvVar,
    name,
}: {
    requestEnv?: string
    defaultEnvVar?: string
    name: string
}): string => requestEnv || defaultEnvVar || toEnvVarName(name)

export const preserveAgentSecretEnvOverride = ({
    current,
    touched,
    requestEnv,
    defaultEnvVar,
    name,
}: {
    current: string
    touched: boolean
    requestEnv?: string
    defaultEnvVar?: string
    name: string
}): string => (touched ? current : suggestedAgentSecretEnv({requestEnv, defaultEnvVar, name}))
