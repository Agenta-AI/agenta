/** The workflow fields the scope reads. */
interface ScopeWorkflow {
    id: string
    flags?: {is_evaluator?: boolean | null} | null
}

/** What an app id scopes the runs list to: an evaluator's runs are those it graded. */
export const resolveRunsScope = (
    appId: string | null,
    workflow: ScopeWorkflow | null | undefined,
): {appId: string | null; evaluatorId: string | null} =>
    appId && workflow?.id === appId && workflow.flags?.is_evaluator
        ? {appId: null, evaluatorId: appId}
        : {appId, evaluatorId: null}
