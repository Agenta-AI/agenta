import {
    agentWorkflowsListQueryStateAtom,
    promptWorkflowsListQueryStateAtom,
    type Workflow,
} from "@agenta/entities/workflow"
import {useAtomValue} from "jotai"

export type OverviewApp =
    | {status: "loading"}
    | {status: "error"}
    | {status: "missing"}
    | {status: "agent"}
    | {status: "app"; app: Workflow}

/**
 * What an app id on the overview URL is. The answer waits for both lists: until the agent flags
 * load, an agent can sit in the prompts list, and the page would flash prompt sections for it.
 */
export const useOverviewApp = (appId: string): OverviewApp => {
    const prompts = useAtomValue(promptWorkflowsListQueryStateAtom)
    const agents = useAtomValue(agentWorkflowsListQueryStateAtom)
    if (prompts.isError || agents.isError) return {status: "error"}
    if (prompts.isPending || agents.isPending) return {status: "loading"}
    if (agents.data.some((entry) => entry.id === appId)) return {status: "agent"}
    const app = prompts.data.find((entry) => entry.id === appId)
    return app ? {status: "app", app} : {status: "missing"}
}
