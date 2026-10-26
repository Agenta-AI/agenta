/**
 * Organization connections — the `/organization-secrets/` routes (M5).
 *
 * Only an organization owner or admin may call them; anyone else gets a 403, which is also how
 * the AI providers page tells an admin from a member without asking for a role. Every call is
 * scoped by the current project, the way the API resolves the organization.
 */
import {getOrganizationSecretsClient} from "@agenta/sdk/resources"
import type {AgentaApi} from "@agentaai/api-client"

import {transformSecret} from "../core/transforms"
import type {ProviderVaultRow, SecretResponseDto} from "../core/types"

import {projectScopedRequest} from "./client"

export type OrganizationSecretAvailability = AgentaApi.SecretAvailability

/** Who may use an organization connection. `projectIds` counts only for `selected_projects`. */
export interface OrganizationSecretProjects {
    availability: OrganizationSecretAvailability
    projectIds: string[]
}

/** Every organization connection, as rows the connection list reads. */
export const fetchOrganizationSecrets = async ({
    projectId,
}: {
    projectId: string
}): Promise<ProviderVaultRow[]> => {
    const result = await getOrganizationSecretsClient().listOrganizationSecrets(
        projectScopedRequest(projectId),
    )
    return transformSecret((result.secrets ?? []) as SecretResponseDto[])
}

export const createOrganizationSecret = async ({
    projectId,
    payload,
    projects,
}: {
    projectId: string
    payload: Pick<AgentaApi.OrganizationSecretCreateRequest, "header" | "secret">
    projects: OrganizationSecretProjects
}) =>
    getOrganizationSecretsClient().createOrganizationSecret(
        {
            ...payload,
            availability: projects.availability,
            project_ids: projects.availability === "selected_projects" ? projects.projectIds : [],
        },
        projectScopedRequest(projectId),
    )

export const editOrganizationSecret = async ({
    projectId,
    secretId,
    payload,
}: {
    projectId: string
    secretId: string
    payload: Omit<AgentaApi.OrganizationSecretEditRequest, "secret_id">
}) =>
    getOrganizationSecretsClient().editOrganizationSecret(
        {secret_id: secretId, ...payload},
        projectScopedRequest(projectId),
    )

export const setOrganizationSecretProjects = async ({
    projectId,
    secretId,
    projects,
}: {
    projectId: string
    secretId: string
    projects: OrganizationSecretProjects
}) =>
    getOrganizationSecretsClient().setOrganizationSecretProjects(
        {
            secret_id: secretId,
            availability: projects.availability,
            project_ids: projects.availability === "selected_projects" ? projects.projectIds : [],
        },
        projectScopedRequest(projectId),
    )

export const deleteOrganizationSecret = async ({
    projectId,
    secretId,
}: {
    projectId: string
    secretId: string
}) =>
    getOrganizationSecretsClient().deleteOrganizationSecret(
        {secret_id: secretId},
        projectScopedRequest(projectId),
    )

/** Check a pasted subscription token with its provider and store it on the connection. */
export const setOrganizationSubscriptionToken = async ({
    projectId,
    secretId,
    token,
}: {
    projectId: string
    secretId: string
    token: string
}) =>
    getOrganizationSecretsClient().setOrganizationSubscriptionToken(
        {secret_id: secretId, token},
        projectScopedRequest(projectId),
    )
