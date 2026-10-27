/**
 * Organization connections — state for the Organization tab of AI providers.
 *
 * Two reads, and no request a screen waits on in series:
 *
 *   - An organization owner or admin reads every organization connection, with who may use it,
 *     from `GET /secrets/?scope=organization`. The page starts that read beside the project's
 *     vault read.
 *   - Anyone else gets a 403 there, and reads the organization connections their project may use
 *     from the project's own vault read (`include_organization`), which the page makes anyway.
 *
 * So the 403 is what says "member": the role is never asked for on its own.
 */

import {isEE} from "@agenta/shared/api"
import {projectIdAtom, userAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

import {
    fetchOrganizationProjects,
    fetchOrganizationSecrets,
    setOrganizationSecretProjects,
    type OrganizationProject,
    type OrganizationSecretProjects,
} from "../api/organizationSecrets"
import {
    httpStatusOf,
    isOrganizationConnection,
    toProviderConnections,
    type ProviderConnection,
} from "../core/connections"
import type {ProviderVaultRow} from "../core/types"

import {vaultSecretsWithOrganizationQueryAtom} from "./atoms"
import {refreshVaultSecretsAtom} from "./subscriptionLogin"

export type {OrganizationProject, OrganizationSecretProjects}

/** A 403 is an answer (not an owner or admin), not a failure to retry. */
const retryUnlessRefused = (failureCount: number, error: unknown) =>
    httpStatusOf(error) !== 403 && failureCount < 1

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
        retry: retryUnlessRefused,
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
    if (query.isError && httpStatusOf(query.error) === 403) return "view"
    if (query.data) return "manage"
    if (query.isError) return "error"
    return "loading"
})

/**
 * Every project of the organization, for an owner or admin choosing who may use a connection
 * (EE: OSS has no choice). Read only once the organization list said "owner or admin": a member
 * never asks.
 */
export const organizationProjectsQueryAtom = atomWithQuery<OrganizationProject[]>((get) => {
    const user = get(userAtom)
    const projectId = get(projectIdAtom)
    const manage = get(organizationConnectionsAccessAtom) === "manage"
    return {
        queryKey: ["vault", "organization-projects", user?.id, projectId],
        queryFn: () => {
            if (!projectId) throw new Error("[vault] Missing projectId for organization projects")
            return fetchOrganizationProjects({projectId})
        },
        enabled: manage && isEE() && !!user && !!projectId,
        staleTime: 1000 * 60 * 5,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        retry: retryUnlessRefused,
    }
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
        await set(refreshVaultSecretsAtom)
    },
)
