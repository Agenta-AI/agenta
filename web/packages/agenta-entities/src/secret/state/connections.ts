/**
 * Provider connections — state for the AI-providers settings surface.
 *
 * Reads the same vault query the rest of the secret entity reads, but presents it as CONNECTIONS
 * rather than as a provider catalog with keys attached: several connections may share a provider
 * family, so the row is the record, not the family. `standardSecretsAtom` keeps its old
 * catalog-joined shape for the surfaces that still want it.
 */

import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {atomWithMutation} from "jotai-tanstack-query"

import {
    probeProvider,
    type ProbeProviderCredentials,
    type ProbeProviderResponse,
} from "../api/probe"
import {
    buildConnectionPayload,
    toProviderConnections,
    type ConnectionDraft,
    type ProviderConnection,
} from "../core/connections"

import {
    createVaultSecretMutationAtom,
    updateVaultSecretMutationAtom,
    vaultSecretsQueryAtom,
} from "./atoms"

/** Every connected provider in the project, standard and custom alike. */
export const providerConnectionsAtom = atom<ProviderConnection[]>((get) =>
    toProviderConnections(get(vaultSecretsQueryAtom).data ?? []),
)

/**
 * Test a credential against its provider.
 *
 * A mutation rather than a query: it spends a credential on an outbound request and must happen
 * only when the user asks for it, never on a re-render or a cache revalidation.
 */
export const probeProviderMutationAtom = atomWithMutation<
    ProbeProviderResponse | null,
    {projectId: string; kind?: string; provider: ProbeProviderCredentials; secretId?: string}
>(() => ({
    mutationFn: ({projectId, kind, provider, secretId}) =>
        probeProvider({projectId, kind, provider, secretId}),
}))

/**
 * Save a connection draft — create when `connectionId` is absent, update otherwise.
 *
 * Models and harnesses go out only when the draft carries them (see `connectionPolicyForSave`):
 * an omitted list leaves the connection on Agenta's defaults, while an explicit `[]` offers none.
 * `fallbackName` names a `custom_provider` whose name field was left empty (the API names an
 * unnamed `provider_key` itself, so that one goes out header-less).
 */
export const saveProviderConnectionAtom = atom(
    null,
    async (
        get,
        _set,
        {
            draft,
            fallbackName,
            connectionId,
        }: {draft: ConnectionDraft; fallbackName: string; connectionId?: string},
    ) => {
        const projectId = get(projectIdAtom)
        if (!projectId) throw new Error("[vault] Missing projectId for saveProviderConnection")

        const payload = buildConnectionPayload(draft, fallbackName)

        if (connectionId) {
            await get(updateVaultSecretMutationAtom).mutateAsync({
                projectId,
                secret_id: connectionId,
                payload: {
                    // A header without a name would ask the API to rename the connection to
                    // nothing; leaving it out keeps the name the record already has.
                    ...(payload.header?.name ? {header: payload.header} : {}),
                    secret: payload.secret,
                },
            })
            return connectionId
        }

        const created = await get(createVaultSecretMutationAtom).mutateAsync({projectId, payload})
        return created.id ?? null
    },
)
