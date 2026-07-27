/** Mobile's own last-visited workspace/project, for `/m/` root resolution. */
export const LAST_CONTEXT_KEY = "agenta:mobile:last-context"

export interface LastContext {
    workspaceId: string
    projectId: string
}

export function writeLastContext(context: LastContext): void {
    try {
        localStorage.setItem(LAST_CONTEXT_KEY, JSON.stringify(context))
    } catch {
        // storage unavailable (private mode / quota) — continuity is best-effort
    }
}
