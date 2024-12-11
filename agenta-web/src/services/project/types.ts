export interface ProjectsResponse {
    workspace_id?: string | null
    workspace_name?: string | null
    project_id: string
    project_name: string
    user_role?: string | null
    is_demo?: boolean | null
    organization_id?: string | null
    organization_name?: string | null
}
