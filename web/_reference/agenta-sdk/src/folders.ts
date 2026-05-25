/**
 * Agenta TypeScript SDK — Folders manager.
 *
 * Folder CRUD and query operations.
 * Endpoints are under / (legacy, no /preview prefix).
 */

import type {AgentaClient} from "./client"
import type {
    FolderCreateRequest,
    FolderEditRequest,
    FolderQueryRequest,
    FolderResponse,
    FoldersResponse,
} from "./types"

export class Folders {
    constructor(private readonly client: AgentaClient) {}

    async create(request: FolderCreateRequest): Promise<FolderResponse> {
        return this.client.post<FolderResponse>("/folders/", request, {legacy: true})
    }

    async get(folderId: string): Promise<FolderResponse> {
        return this.client.get<FolderResponse>(`/folders/${folderId}`, {legacy: true})
    }

    async update(folderId: string, request: FolderEditRequest): Promise<FolderResponse> {
        return this.client.put<FolderResponse>(`/folders/${folderId}`, request, {legacy: true})
    }

    async delete(folderId: string): Promise<void> {
        await this.client.delete(`/folders/${folderId}`, {legacy: true})
    }

    async query(request?: FolderQueryRequest, projectId?: string): Promise<FoldersResponse> {
        const params: Record<string, string> = {}
        if (projectId) params.project_id = projectId
        return this.client.post<FoldersResponse>("/folders/query", request ?? {}, {
            legacy: true,
            params,
        })
    }
}
