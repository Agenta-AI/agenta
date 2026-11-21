import {useMemo} from "react"

import {
    approvalChoicesQueryAtom,
    createApprovalChoice,
    deleteApprovalChoice,
    invalidateApprovalChoices,
} from "@agenta/entities/approvalChoice"
import {canonicalClientToolName} from "@agenta/shared/clientTools"
import {projectIdAtom} from "@agenta/shared/state"
import {atom, useAtomValue} from "jotai"

/** The builder tools that accept a person's "always approve" (design D32), by name. */
const APPROVAL_CHOICE_TOOLS = ["start_session", "create_agent", "edit_agent_config"] as const

/** The call ref a choice is stored under, `tools.agenta.<name>`. */
const callRefOf = (toolName: string): string | null => {
    const name = canonicalClientToolName(toolName)
    return (APPROVAL_CHOICE_TOOLS as readonly string[]).includes(name)
        ? `tools.agenta.${name}`
        : null
}

const noChoicesAtom = atom<{data?: undefined}>({})

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
    const choices = useAtomValue(enabled ? approvalChoicesQueryAtom : noChoicesAtom).data
    return useMemo(() => {
        const mine = choices ?? []
        const choiceOf = (toolName: string) => {
            const callRef = callRefOf(toolName)
            return callRef ? mine.find((choice) => choice.call_ref === callRef) : undefined
        }
        const ready = Boolean(enabled && projectId && choices)
        return {
            alwaysApprove: ready
                ? {
                      toolNames: new Set<string>(
                          APPROVAL_CHOICE_TOOLS.filter((name) => !choiceOf(name)),
                      ),
                      choose: (toolNames: string[]) => {
                          for (const toolName of toolNames) {
                              const callRef = callRefOf(toolName)
                              if (!callRef) continue
                              run(
                                  createApprovalChoice({
                                      projectId: projectId as string,
                                      callRef,
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
    }, [enabled, choices, projectId])
}
