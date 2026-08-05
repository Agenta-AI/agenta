/**
 * Agenta TypeScript SDK — Workspaces manager.
 *
 * Workspace details, members, roles, and invitations.
 */

import type {AgentaClient} from "./client"
import type {WorkspaceRoleItem, WorkspaceMemberItem, WorkspaceInviteData} from "./types"

export class Workspaces {
    constructor(private readonly client: AgentaClient) {}

    async get<T = unknown>(workspaceId: string): Promise<T> {
        return this.client.get<T>(`/workspaces/${workspaceId}`, {legacy: true})
    }

    async getMembers(workspaceId: string): Promise<WorkspaceMemberItem[]> {
        return this.client.get<WorkspaceMemberItem[]>(`/workspaces/${workspaceId}/members`, {
            legacy: true,
        })
    }

    async getRoles(): Promise<WorkspaceRoleItem[]> {
        return this.client.get<WorkspaceRoleItem[]>("/workspaces/roles", {legacy: true})
    }

    async update(params: {orgId: string; wsId: string; name: string}): Promise<unknown> {
        return this.client.put(
            `/organizations/${params.orgId}/workspaces/${params.wsId}/`,
            {name: params.name},
            {legacy: true},
        )
    }

    async assignRole(params: {
        orgId: string
        wsId: string
        email: string
        role: string
    }): Promise<unknown> {
        return this.client.post(
            `/workspaces/${params.wsId}/roles`,
            {
                email: params.email,
                organization_id: params.orgId,
                role: params.role,
            },
            {legacy: true},
        )
    }

    async unassignRole(params: {
        orgId: string
        wsId: string
        email: string
        role: string
    }): Promise<unknown> {
        return this.client.request("DELETE", `/workspaces/${params.wsId}/roles`, {
            legacy: true,
            params: {
                email: params.email,
                organization_id: params.orgId,
                role: params.role,
            },
        })
    }

    async removeUser(params: {orgId: string; wsId: string; email: string}): Promise<unknown> {
        return this.client.request("DELETE", `/workspaces/${params.wsId}/users`, {
            legacy: true,
            params: {email: params.email, organization_id: params.orgId},
        })
    }

    async invite(params: {
        orgId: string
        wsId: string
        data: WorkspaceInviteData[]
    }): Promise<unknown> {
        return this.client.post(
            `/organizations/${params.orgId}/workspaces/${params.wsId}/invite`,
            params.data,
            {legacy: true},
        )
    }

    async resendInvite(params: {orgId: string; wsId: string; email: string}): Promise<unknown> {
        return this.client.post(
            `/organizations/${params.orgId}/workspaces/${params.wsId}/invite/resend`,
            {email: params.email},
            {legacy: true},
        )
    }

    async acceptInvite(params: {
        token: string
        orgId: string
        wsId: string
        projectId: string
        email?: string
    }): Promise<unknown> {
        return this.client.post(
            `/organizations/${params.orgId}/workspaces/${params.wsId}/invite/accept`,
            {token: params.token, ...(params.email ? {email: params.email} : {})},
            {legacy: true, params: {project_id: params.projectId}},
        )
    }
}
