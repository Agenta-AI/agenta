import {
    agentWorkflowsListQueryStateAtom,
    promptWorkflowsListQueryStateAtom,
    workflowDetailQueryAtomFamily,
    type Workflow,
} from "@agenta/entities/workflow"
import {betaDeveloperModeActiveAtom} from "@agenta/shared/state"
import {atom, useAtomValue} from "jotai"

export type OverviewApp =
    | {status: "loading"}
    | {status: "error"}
    | {status: "missing"}
    | {status: "agent"}
    | {status: "app"; app: Workflow}
    | {status: "evaluator"; app: Workflow}

const NO_DETAIL = atom({
    data: null as Workflow | null | undefined,
    isPending: false,
    isError: false,
})

/**
 * What an app id on the overview URL is. The answer waits for both lists: until the agent flags
 * load, an agent can sit in the prompts list, and the page would flash prompt sections for it.
 * In beta developer mode an id that is no app may be an evaluator, which has an overview as in
 * the old app; its detail loads only then.
 */
export const useOverviewApp = (appId: string): OverviewApp => {
    const prompts = useAtomValue(promptWorkflowsListQueryStateAtom)
    const agents = useAtomValue(agentWorkflowsListQueryStateAtom)
    const beta = useAtomValue(betaDeveloperModeActiveAtom)
    const listsSettled = !prompts.isPending && !agents.isPending
    const notAnApp =
        listsSettled &&
        !agents.data.some((entry) => entry.id === appId) &&
        !prompts.data.some((entry) => entry.id === appId)
    const detail = useAtomValue(beta && notAnApp ? workflowDetailQueryAtomFamily(appId) : NO_DETAIL)

    if (prompts.isError || agents.isError) return {status: "error"}
    if (!listsSettled) return {status: "loading"}
    if (agents.data.some((entry) => entry.id === appId)) return {status: "agent"}
    const app = prompts.data.find((entry) => entry.id === appId)
    if (app) return {status: "app", app}
    if (!beta) return {status: "missing"}
    if (detail.isPending) return {status: "loading"}
    if (detail.isError) return {status: "error"}
    const workflow = detail.data
    return workflow?.flags?.is_evaluator && !workflow.deleted_at
        ? {status: "evaluator", app: workflow}
        : {status: "missing"}
}
