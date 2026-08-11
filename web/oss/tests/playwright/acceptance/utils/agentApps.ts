import type {Page} from "@playwright/test"

/**
 * Skip reason for environments (e.g. OSS previews) where the agent platform is disabled:
 * creating an "agent" app silently yields a prompt-type app, so agent-only UI never exists.
 */
export const AGENT_APPS_UNAVAILABLE_REASON =
    "agent-type apps are not available in this environment (feature flags off)"

interface WorkflowRevisionLike {
    flags?: {is_agent?: boolean} | null
    data?: {uri?: string | null} | null
}

/** Agent-ness is server-derived: commit infers `flags.is_agent` from the revision URI. */
export const isAgentRevision = (revision: WorkflowRevisionLike | null | undefined): boolean =>
    revision?.flags?.is_agent === true

export const resolveApiBase = (page: Page): string => {
    if (process.env.AGENTA_API_URL) return process.env.AGENTA_API_URL
    const origin = new URL(page.url() || process.env.AGENTA_WEB_URL || "http://localhost:3000")
        .origin
    return `${origin}/api`
}

/** Best-effort archive so a non-agent leftover cannot pollute app lists used by other specs. */
export const archiveWorkflow = async (
    page: Page,
    apiBase: string,
    projectId: string,
    workflowId: string,
): Promise<void> => {
    await page.request
        .post(`${apiBase}/workflows/${workflowId}/archive?project_id=${projectId}`)
        .catch(() => undefined)
}

/**
 * Resolve whether the app's committed revisions mark it agent-type.
 * Returns "unknown" while no revision is readable — callers must skip only on the definitive
 * "not-agent" answer so transient reads cannot hide real failures in agent-capable environments.
 */
export const queryWorkflowAgentState = async (
    page: Page,
    apiBase: string,
    projectId: string,
    workflowId: string,
    timeoutMs = 15000,
): Promise<"agent" | "not-agent" | "unknown"> => {
    const deadline = Date.now() + timeoutMs
    do {
        const response = await page.request
            .post(`${apiBase}/workflows/revisions/query?project_id=${projectId}`, {
                data: {workflow_refs: [{id: workflowId}]},
            })
            .catch(() => null)
        if (response?.ok()) {
            const body = (await response.json().catch(() => null)) as {
                workflow_revisions?: WorkflowRevisionLike[]
            } | null
            const revisions = body?.workflow_revisions ?? []
            if (revisions.some(isAgentRevision)) return "agent"
            // Classify "not-agent" only once a data-bearing revision landed, so an early
            // placeholder commit cannot trigger a wrong skip in agent-capable environments.
            if (revisions.some((revision) => Boolean(revision?.data?.uri))) return "not-agent"
        }
        await new Promise((resolve) => setTimeout(resolve, 1000))
    } while (Date.now() < deadline)
    return "unknown"
}
