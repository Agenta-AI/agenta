export enum FolderKind {
    Applications = "applications",
}

export interface FolderBase {
    name?: string | null
    description?: string | null
    slug?: string | null
    tags?: Record<string, any> | null
    flags?: Record<string, any> | null
    meta?: Record<string, any> | null
    kind?: FolderKind | null
}

export interface Folder extends FolderBase {
    id?: string
    path?: string | null
    parent_id?: string | null
    created_at?: string | null
    updated_at?: string | null
    deleted_at?: string | null
    created_by_id?: string | null
    updated_by_id?: string | null
    deleted_by_id?: string | null
}

export interface FolderCreate extends FolderBase {
    parent_id?: string | null
}

export interface FolderEdit extends FolderBase {
    id: string
    parent_id?: string | null
}

export interface FolderQuery extends FolderBase {
    id?: string
    ids?: string[]
    slugs?: string[]
    kinds?: boolean | FolderKind[]
    parent_id?: string | null
    parent_ids?: string[]
    path?: string
    paths?: string[]
    prefix?: string
    prefixes?: string[]
}

export interface FolderResponse {
    count: number
    folder?: Folder | null
}

export interface FoldersResponse {
    count: number
    folders: Folder[]
}

export interface FolderIdResponse {
    count: number
    id?: string | null
}

export interface FolderCreateRequest {
    folder: FolderCreate
}

export interface FolderEditRequest {
    folder: FolderEdit
}

export interface FolderQueryRequest {
    folder?: FolderQuery
}
