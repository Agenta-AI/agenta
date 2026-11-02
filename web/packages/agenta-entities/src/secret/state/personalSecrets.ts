/**
 * Personal accounts: the caller's own secrets, and whether the deployment has personal accounts
 * at all. One read answers both: `GET /secrets/?scope=user` lists the rows, or answers 403 when
 * the switch is off (or the caller is no person), and every screen reads the switch from it.
 */
import {projectIdAtom, userAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

import {fetchPersonalSecrets} from "../api/personalSecrets"
import {httpStatusOf} from "../core/connections"
import {SecretKind, type NamedSecretRow, type ProviderVaultRow} from "../core/types"

export const PERSONAL_SECRETS_KEY = ["vault", "personal-secrets"] as const

/** A 403 is an answer (personal accounts are off for this caller), not a failure to retry. */
const retryUnlessRefused = (failureCount: number, error: unknown) =>
    httpStatusOf(error) !== 403 && failureCount < 1

export const personalSecretsQueryAtom = atomWithQuery<ProviderVaultRow[]>((get) => {
    const user = get(userAtom)
    const projectId = get(projectIdAtom)
    return {
        queryKey: [...PERSONAL_SECRETS_KEY, user?.id, projectId],
        queryFn: () => {
            if (!projectId) throw new Error("[vault] Missing projectId for personal secrets")
            return fetchPersonalSecrets({projectId})
        },
        enabled: !!user && !!projectId,
        staleTime: 1000 * 60 * 5,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        retry: retryUnlessRefused,
    }
})

/**
 * Whether the caller may have accounts of their own: `on`, `off` (the deployment switch, or a
 * caller that is no person), `loading`, or `error` (the read failed; "Yours" stays hidden).
 */
export type PersonalAccountsAccess = "loading" | "on" | "off" | "error"

export const personalAccountsAccessAtom = atom<PersonalAccountsAccess>((get) => {
    const query = get(personalSecretsQueryAtom)
    if (query.isError) return httpStatusOf(query.error) === 403 ? "off" : "error"
    if (query.data) return "on"
    return "loading"
})

/**
 * The caller's own named secrets, for the Secrets page and the agent's "Account" select. Each
 * row is marked as the person's, so an edit or a delete names the owner on its route even when
 * the response leaves the owner out.
 */
export const personalNamedSecretsAtom = atom<NamedSecretRow[]>((get) =>
    (get(personalSecretsQueryAtom).data ?? [])
        .filter((secret) => secret.type === SecretKind.CustomSecret)
        .map((secret) => ({...(secret as NamedSecretRow), ownerKind: "user" as const})),
)
