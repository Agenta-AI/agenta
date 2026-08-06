/**
 * Agenta TypeScript SDK — Projects manager.
 *
 * Project CRUD operations.
 * Endpoints are under / (legacy, no /preview prefix).
 */

import type {AgentaClient} from "./client"
import type {ProjectItem, ProjectCreateRequest, ProjectPatchRequest} from "./types"

export class Projects {
    constructor(private readonly client: AgentaClient) {}

    async list(): Promise<ProjectItem[]> {
        return this.client.get<ProjectItem[]>("/projects", {legacy: true})
    }

    async get(projectId: string): Promise<ProjectItem> {
        return this.client.get<ProjectItem>(`/projects/${projectId}`, {legacy: true})
    }

    async create(request: ProjectCreateRequest): Promise<ProjectItem> {
        return this.client.post<ProjectItem>("/projects", request, {legacy: true})
    }

    async update(projectId: string, request: ProjectPatchRequest): Promise<ProjectItem> {
        return this.client.request<ProjectItem>("PATCH", `/projects/${projectId}`, {
            body: request,
            legacy: true,
        })
    }

    async delete(projectId: string): Promise<void> {
        await this.client.delete(`/projects/${projectId}`, {legacy: true})
    }
}
