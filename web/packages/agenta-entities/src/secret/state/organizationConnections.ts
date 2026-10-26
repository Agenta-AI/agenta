/**
 * Organization connections — state for the Organization tab of AI providers (M5).
 *
 * Two reads, and no request a screen waits on in series:
 *
 *   - An organization owner or admin reads every organization connection, with who may use it,
 *     from `/organization-secrets/`. The page starts that read beside the project's vault read.
 *   - Anyone else gets a 403 there, and reads the organization connections their project may use
 *     from the project's own vault read (`include_organization`), which the page makes anyway.
 *
 * So the 403 is what says "member": the role is never asked for on its own.
 */

import {getHostQueryClient} from "@agenta/shared/api"
import {projectIdAtom, userAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

import {
    createOrganizationSecret,
    deleteOrganizationSecret,
    editOrganizationSecret,
    fetchOrganizationSecrets,
    setOrganizationSecretProjects,
    setOrganizationSubscriptionToken,
    type OrganizationSecretProjects,
} from "../api/organizationSecrets"
import {
    buildConnectionPayload,
    isOrganizationConnection,
    toProviderConnections,
    type ConnectionDraft,
    type ProviderConnection,
} from "../core/connections"
import {transformSecret} from "../core/transforms"
import type {ProviderVaultRow, SecretResponseDto} from "../core/types"

import {vaultSecretsWithOrganizationQueryAtom} from "./atoms"
import {buildSubscriptionSecretPayload} from "./subscriptionLogin"

export type {OrganizationSecretProjects}

const statusOf = (error: unknown): number | null => {
    const statusCode = (error as {statusCode?: unknown} | null)?.statusCode
    if (typeof statusCode === "number") return statusCode
    const status = (error as {response?: {status?: unknown}} | null)?.response?.status
    return typeof status === "number" ? status : null
}

/** Every organization connection, for an organization owner or admin. A 403 for anyone else. */
export const organizationSecretsQueryAtom = atomWithQuery<ProviderVaultRow[]>((get) => {
    const user = get(userAtom)
    const projectId = get(projectIdAtom)
    return {
        queryKey: ["vault", "organization-secrets", user?.id, projectId],
        queryFn: () => {
            if (!projectId) throw new Error("[vault] Missing projectId for organization secrets")
            return fetchOrganizationSecrets({projectId})
        },
        enabled: !!user && !!projectId,
        staleTime: 1000 * 60 * 5,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        // A 403 is an answer (not an owner or admin), not a failure to retry.
        retry: (failureCount, error) => statusOf(error) !== 403 && failureCount < 1,
    }
})

/**
 * What the Organization tab may show. `manage` is an owner or admin; `view` is anyone else, who
 * sees only the connections their project may use, read-only.
 */
export type OrganizationConnectionsAccess = "loading" | "manage" | "view" | "error"

export const organizationConnectionsAccessAtom = atom<OrganizationConnectionsAccess>((get) => {
    const query = get(organizationSecretsQueryAtom)
    // A 403 wins over cached rows: someone who stopped being an owner or admin sees the
    // read-only view at once, not the list they could manage before.
    if (query.isError && statusOf(query.error) === 403) return "view"
    if (query.data) return "manage"
    if (query.isError) return "error"
    return "loading"
})

/** Every organization connection, with who may use it (an owner or admin's read). */
export const managedOrganizationConnectionsAtom = atom<ProviderConnection[]>((get) =>
    toProviderConnections(get(organizationSecretsQueryAtom).data ?? []),
)

/** The organization connections this project may use, from the project's own vault read. */
export const organizationProviderConnectionsAtom = atom<ProviderConnection[]>((get) =>
    toProviderConnections(get(vaultSecretsWithOrganizationQueryAtom).data ?? []).filter(
        isOrganizationConnection,
    ),
)

/**
 * Refetch both reads, so a change shows on the tab and in every picker. Not awaited by a save:
 * the write has answered, and the user does not wait on the reads that follow it.
 */
export const refreshOrganizationConnectionsAtom = atom(null, async () => {
    await getHostQueryClient().invalidateQueries({queryKey: ["vault"]})
})

/**
 * Save an organization connection draft: create it with its projects, or change it.
 *
 * A change writes the credential and the name first, then the projects, and only when they
 * changed: they are two routes, and an untouched projects choice must not cost a request.
 */
export const saveOrganizationConnectionAtom = atom(
    null,
    async (
        get,
        set,
        {
            draft,
            fallbackName,
            connectionId,
            projects,
            projectsChanged,
            connectionChanged = true,
        }: {
            draft: ConnectionDraft
            fallbackName: string
            connectionId?: string
            projects: OrganizationSecretProjects
            projectsChanged: boolean
            /** False when only the projects changed: the credential write is skipped. */
            connectionChanged?: boolean
        },
    ): Promise<string | null> => {
        const projectId = get(projectIdAtom)
        if (!projectId) throw new Error("[vault] Missing projectId for organization connection")

        const payload = buildConnectionPayload(draft, fallbackName)

        if (connectionId) {
            if (connectionChanged) {
                await editOrganizationSecret({
                    projectId,
                    secretId: connectionId,
                    payload: {
                        ...(payload.header?.name ? {header: payload.header} : {}),
                        secret: payload.secret,
                    },
                })
            }
            if (projectsChanged) {
                await setOrganizationSecretProjects({projectId, secretId: connectionId, projects})
            }
            void set(refreshOrganizationConnectionsAtom)
            return connectionId
        }

        const created = await createOrganizationSecret({projectId, payload, projects})
        void set(refreshOrganizationConnectionsAtom)
        return created.id ?? null
    },
)

/** Change only who may use an organization connection. */
export const setOrganizationConnectionProjectsAtom = atom(
    null,
    async (
        get,
        set,
        {connectionId, projects}: {connectionId: string; projects: OrganizationSecretProjects},
    ) => {
        const projectId = get(projectIdAtom)
        if (!projectId) throw new Error("[vault] Missing projectId for organization connection")
        await setOrganizationSecretProjects({projectId, secretId: connectionId, projects})
        void set(refreshOrganizationConnectionsAtom)
    },
)

export const deleteOrganizationConnectionAtom = atom(
    null,
    async (get, set, connection: ProviderConnection) => {
        const projectId = get(projectIdAtom)
        if (!projectId) throw new Error("[vault] Missing projectId for organization connection")
        await deleteOrganizationSecret({projectId, secretId: connection.id})
        void set(refreshOrganizationConnectionsAtom)
    },
)

/** Create an organization subscription connection with its projects. Returns its record id. */
export const createOrganizationSubscriptionConnectionAtom = atom(
    null,
    async (
        get,
        _set,
        {
            provider,
            name,
            projects,
        }: {provider: string; name: string; projects: OrganizationSecretProjects},
    ): Promise<string> => {
        const projectId = get(projectIdAtom)
        if (!projectId) throw new Error("[vault] Missing projectId for organization connection")
        // No name unless one was typed: the API names it "ChatGPT (Organization)".
        const created = await createOrganizationSecret({
            projectId,
            payload: buildSubscriptionSecretPayload(provider, name),
            projects,
        })
        if (!created.id) throw new Error("[vault] The connection was created without an id")
        return created.id
    },
)

/** Store a pasted token on an organization subscription connection. */
export const setOrganizationSubscriptionTokenAtom = atom(
    null,
    async (get, set, {secretId, token}: {secretId: string; token: string}): Promise<void> => {
        const projectId = get(projectIdAtom)
        if (!projectId) throw new Error("[vault] Missing projectId for organization connection")
        const saved = await setOrganizationSubscriptionToken({projectId, secretId, token})
        // The answer is the saved row: it replaces the cached one at once, and both lists
        // refetch in the background.
        const [row] = transformSecret([saved as SecretResponseDto])
        const queryClient = getHostQueryClient()
        if (row) {
            queryClient.setQueriesData<ProviderVaultRow[]>(
                {queryKey: ["vault", "organization-secrets"]},
                (rows) => rows?.map((item) => (item.id === row.id ? row : item)),
            )
        }
        void queryClient.invalidateQueries({queryKey: ["vault"]})
    },
)
