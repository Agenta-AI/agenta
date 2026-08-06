// `id` matches a registered view in `scopes/viewRegistry`; resolution falls back
// to the base view for any unknown id.
export interface SidebarView {
    id: string
    lastPath?: string | null
}
