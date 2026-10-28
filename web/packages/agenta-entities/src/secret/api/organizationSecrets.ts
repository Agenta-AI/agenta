/**
 * Organization connections on the `/secrets/` routes.
 *
 * Only an organization owner or admin may list, create or limit them; anyone else gets a 403,
 * which is also how the AI providers page tells an admin from a member without asking for a
 * role. Editing, deleting and signing in use the same by-id routes with `scope: organization`.
 * Every call is scoped by the current project, the way the API resolves the organization.
 */
import {getProjectsClient} from "@agenta/sdk/resources"
import type {AgentaApi} from "@agentaai/api-client"

import {transformSecret} from "../core/transforms"
import type {CreateSecretDto, ProviderVaultRow, SecretResponseDto} from "../core/types"

import {getSecretsClient, projectScopedRequest} from "./client"

export type OrganizationSecretAvailability = AgentaApi.SecretAvailability

/** Who may use an organization connection. `projectIds` counts only for `selected_projects`. */
export interface OrganizationSecretProjects {
    availability: OrganizationSecretAvailability
    projectIds: string[]
}

/** A project an owner or admin may choose for an organization connection. */
export interface OrganizationProject {
    id: string
    name: string
}

const projectIdsOf = (projects: OrganizationSecretProjects) =>
    projects.availability === "selected_projects" ? projects.projectIds : []

/** Every organization connection, as rows the connection list reads. */
export const fetchOrganizationSecrets = async ({
    projectId,
}: {
    projectId: string
}): Promise<ProviderVaultRow[]> => {
    const result = await getSecretsClient().listSecrets(
        {scope: "organization"},
        projectScopedRequest(projectId),
    )
    return transformSecret(result as SecretResponseDto[])
}

/** Every project of the organization, also the ones the caller is not a member of. */
export const fetchOrganizationProjects = async ({
    projectId,
}: {
    projectId: string
}): Promise<OrganizationProject[]> => {
    const projects = await getProjectsClient().getProjects(
        {scope: "organization"},
        projectScopedRequest(projectId),
    )
    return projects.map((project) => ({id: project.project_id, name: project.project_name}))
}

export const createOrganizationSecret = async ({
    projectId,
    payload,
    projects,
}: {
    projectId: string
    payload: Pick<CreateSecretDto, "header" | "secret">
    projects: OrganizationSecretProjects
}) =>
    getSecretsClient().createSecret(
        {
            ...payload,
            scope: "organization",
            availability: projects.availability,
            project_ids: projectIdsOf(projects),
        },
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
    getSecretsClient().setSecretProjects(
        {
            secret_id: secretId,
            availability: projects.availability,
            project_ids: projectIdsOf(projects),
        },
        projectScopedRequest(projectId),
    )
