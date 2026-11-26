/**
 * Project-scoped query keys for the Sharing API. Every key carries the project id, so a
 * project switch never serves another project's sharing state from the cache.
 */
export const sharingKeys = {
    agent: (workflowId: string, projectId: string) =>
        ["sharing", "agent", workflowId, projectId] as const,
    session: (sessionId: string, projectId: string) =>
        ["sharing", "session", sessionId, projectId] as const,
    members: (projectId: string, search: string) =>
        ["sharing", "members", projectId, search] as const,
    roster: (projectId: string) => ["sharing", "roster", projectId] as const,
}
