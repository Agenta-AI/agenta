import {useMemo} from "react"

import {
    approvalChoicesQueryAtom,
    createApprovalChoice,
    deleteApprovalChoice,
    invalidateApprovalChoices,
} from "@agenta/entities/approvalChoice"
import {builderAgentRevisionIdQueryAtom, workflowQueryAtomFamily} from "@agenta/entities/workflow"
import {canonicalClientToolName} from "@agenta/shared/clientTools"
import {projectIdAtom} from "@agenta/shared/state"
import {atom, useAtomValue} from "jotai"

/** The builder tools that accept a person's "always approve" (design D32), by name. */
const APPROVAL_CHOICE_TOOLS = ["start_session", "create_agent", "edit_agent_config"] as const

/** The call ref a choice is stored under, `tools.agenta.<name>`. */
const toolKeyOf = (toolName: string): string | null => {
    const name = canonicalClientToolName(toolName)
    return (APPROVAL_CHOICE_TOOLS as readonly string[]).includes(name)
        ? `tools.agenta.${name}`
        : null
}

/** The builder's artifact id, the agent a choice names. */
const builderWorkflowIdAtom = atom((get) => {
    const revisionId = get(builderAgentRevisionIdQueryAtom).data ?? null
    return revisionId ? (get(workflowQueryAtomFamily(revisionId)).data?.workflow_id ?? null) : null
})

const noChoicesAtom = atom<{data?: undefined}>({})
const noWorkflowAtom = atom<string | null>(null)

const run = (write: Promise<unknown>) => {
    // A failed write leaves the choice as it was; the rows read the choices again either way.
    void write.catch(() => undefined).finally(() => void invalidateApprovalChoices())
}

/**
 * The person's "always approve" for the builder's tools: the approval card stores a choice
 * instead of writing the builder's configuration, and a result row turns it off. The server
 * applies a choice only in the person's own turns in a session private to them. Off (`enabled`
 * false, any chat but the builder's), it reads nothing.
 */
export const useBuilderApprovalChoices = (enabled: boolean) => {
    const projectId = useAtomValue(projectIdAtom)
    const workflowId = useAtomValue(enabled ? builderWorkflowIdAtom : noWorkflowAtom)
    const choices = useAtomValue(enabled ? approvalChoicesQueryAtom : noChoicesAtom).data
    return useMemo(() => {
        const mine = (choices ?? []).filter((choice) => choice.workflow_id === workflowId)
        const choiceOf = (toolName: string) => {
            const toolKey = toolKeyOf(toolName)
            return toolKey ? mine.find((choice) => choice.tool_key === toolKey) : undefined
        }
        const ready = Boolean(enabled && projectId && workflowId && choices)
        return {
            alwaysApprove: ready
                ? {
                      toolNames: new Set<string>(
                          APPROVAL_CHOICE_TOOLS.filter((name) => !choiceOf(name)),
                      ),
                      choose: (toolNames: string[]) => {
                          for (const toolName of toolNames) {
                              const toolKey = toolKeyOf(toolName)
                              if (!toolKey) continue
                              run(
                                  createApprovalChoice({
                                      projectId: projectId as string,
                                      workflowId: workflowId as string,
                                      toolKey,
                                  }),
                              )
                          }
                      },
                  }
                : undefined,
            autoApprove: enabled
                ? {
                      isOn: (toolName: string) => Boolean(choiceOf(toolName)),
                      turnOff: (toolName: string) => {
                          const choice = choiceOf(toolName)
                          if (!choice || !projectId) return
                          run(deleteApprovalChoice({projectId, approvalChoiceId: choice.id}))
                      },
                  }
                : undefined,
        }
    }, [enabled, choices, projectId, workflowId])
}
