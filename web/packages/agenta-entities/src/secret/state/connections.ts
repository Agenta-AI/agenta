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
    createOrganizationSecret,
    setOrganizationSecretProjects,
    type OrganizationSecretProjects,
} from "../api/organizationSecrets"
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
import {refreshVaultSecretsAtom} from "./subscriptionLogin"

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
    {
        projectId: string
        kind?: string
        provider: ProbeProviderCredentials
        secretId?: string
        secretScope?: "organization"
    }
>(() => ({
    mutationFn: ({projectId, kind, provider, secretId, secretScope}) =>
        probeProvider({projectId, kind, provider, secretId, secretScope}),
}))

/**
 * Save a connection draft — create when `connectionId` is absent, update otherwise.
 *
 * Models and harnesses go out only when the draft carries them (see `connectionPolicyForSave`):
 * an omitted list leaves the connection on Agenta's defaults, while an explicit `[]` offers none.
 * `fallbackName` names a `custom_provider` whose name field was left empty (the API names an
 * unnamed `provider_key` itself, so that one goes out header-less).
 *
 * With `organization`, the connection is the organization's: it is created with its projects,
 * and a change writes the credential and, when they changed, the projects in parallel. Both
 * lists refresh after any write that landed, also when the other one failed; the failure is
 * thrown after the refresh, so the caller keeps its unsaved choice on screen.
 */
export const saveProviderConnectionAtom = atom(
    null,
    async (
        get,
        set,
        {
            draft,
            fallbackName,
            connectionId,
            organization,
        }: {
            draft: ConnectionDraft
            fallbackName: string
            connectionId?: string
            organization?: {projects: OrganizationSecretProjects; projectsChanged: boolean}
        },
    ) => {
        const projectId = get(projectIdAtom)
        if (!projectId) throw new Error("[vault] Missing projectId for saveProviderConnection")

        const payload = buildConnectionPayload(draft, fallbackName)

        if (!organization) {
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
            const created = await get(createVaultSecretMutationAtom).mutateAsync({
                projectId,
                payload,
            })
            return created.id ?? null
        }

        if (!connectionId) {
            const created = await createOrganizationSecret({
                projectId,
                payload,
                projects: organization.projects,
            })
            await set(refreshVaultSecretsAtom)
            return created.id ?? null
        }

        const writes: Promise<unknown>[] = [
            get(updateVaultSecretMutationAtom).mutateAsync({
                projectId,
                secret_id: connectionId,
                scope: "organization",
                payload: {
                    ...(payload.header?.name ? {header: payload.header} : {}),
                    secret: payload.secret,
                },
            }),
        ]
        if (organization.projectsChanged) {
            writes.push(
                setOrganizationSecretProjects({
                    projectId,
                    secretId: connectionId,
                    projects: organization.projects,
                }),
            )
        }
        const results = await Promise.allSettled(writes)
        await set(refreshVaultSecretsAtom)
        const failed = results.find((result) => result.status === "rejected")
        if (failed) throw (failed as PromiseRejectedResult).reason
        return connectionId
    },
)
