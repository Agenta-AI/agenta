export const MAIN_SIDEBAR_SCOPE_ID = "main"
export const SETTINGS_SIDEBAR_SCOPE_ID = "settings"
export const WORKFLOW_SIDEBAR_SCOPE_ID = "workflow"

/** Key of the project-scope "Home" item. Single source shared by useSidebarConfig + mainScope. */
export const HOME_SIDEBAR_KEY = "app-management-link"

/** Key of the project-scope "Sessions" item — see the entity registry for its dynamic children.
 * The agent-scope item is `app-sessions-link` in `useSidebarConfig`. */
export const SESSIONS_SIDEBAR_KEY = "project-sessions-link"

/** Key of the project-scope "Skills" item (the skill registry page). */
export const SKILLS_SIDEBAR_KEY = "project-skills-link"
