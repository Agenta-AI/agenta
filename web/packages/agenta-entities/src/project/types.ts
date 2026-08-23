export interface ProjectsResponse {
    project_id: string
    project_name: string
    workspace_id?: string | null
    workspace_name?: string | null
    organization_id?: string | null
    organization_name?: string | null
    user_role?: string | null
    is_demo?: boolean | null
    is_default_project?: boolean
}
