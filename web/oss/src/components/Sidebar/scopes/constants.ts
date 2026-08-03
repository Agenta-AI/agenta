export const MAIN_SIDEBAR_SCOPE_ID = "main"
export const SETTINGS_SIDEBAR_SCOPE_ID = "settings"
export const WORKFLOW_SIDEBAR_SCOPE_ID = "workflow"

/** Key of the project-scope "Home" item. Single source shared by useSidebarConfig + mainScope. */
export const HOME_SIDEBAR_KEY = "app-management-link"

/** Key of the project-scope "Sessions" item. No dynamic children yet — the recent/pinned
 * sub-list needs grouping + status adornments the entity registry doesn't express. */
export const SESSIONS_SIDEBAR_KEY = "project-sessions-link"
