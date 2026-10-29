import {useCallback} from "react"

import {projectIdAtom} from "@agenta/shared/state"
import {archiveSkill, unarchiveSkill} from "@agenta/skills"
import {invalidateSkillsListCache} from "@agenta/skills/state"
import {message} from "@agenta/ui/app-message"
import {useAtomValue} from "jotai"

/**
 * The registry verbs a row's kebab runs. Each one is the same call the detail drawer makes,
 * followed by the same invalidation, so a row and the drawer can never disagree about a skill.
 */
export const useSkillActions = () => {
    const projectId = useAtomValue(projectIdAtom) ?? ""

    const archive = useCallback(
        async (workflowId: string) => {
            await archiveSkill({projectId, workflowId})
            invalidateSkillsListCache()
            message.success("Skill archived")
        },
        [projectId],
    )

    const restore = useCallback(
        async (workflowId: string) => {
            try {
                await unarchiveSkill({projectId, workflowId})
                invalidateSkillsListCache()
                message.success("Skill restored")
            } catch {
                message.error("Couldn't restore this skill")
            }
        },
        [projectId],
    )

    return {archive, restore}
}
