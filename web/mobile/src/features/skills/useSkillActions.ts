import {useCallback} from "react"

import {downloadSkill} from "@agenta/entity-ui/drill-in"
import {projectIdAtom} from "@agenta/shared/state"
import {archiveSkill, fetchSkillRevisions, unarchiveSkill} from "@agenta/skills"
import {invalidateSkillsListCache} from "@agenta/skills/state"
import {skillRevisionsQueryKey} from "@agenta/skills-ui"
import {message} from "@agenta/ui/app-message"
import {useQueryClient} from "@tanstack/react-query"
import {useAtomValue} from "jotai"

/**
 * The registry verbs a row's kebab runs. Each one is the same call the detail drawer makes,
 * followed by the same invalidation, so a row and the drawer can never disagree about a skill.
 */
export const useSkillActions = () => {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const queryClient = useQueryClient()

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

    // The drawer's own query key, so a skill already opened downloads from cache.
    const download = useCallback(
        async (workflowId: string) => {
            const queryKey = skillRevisionsQueryKey(projectId, workflowId)
            const hide = queryClient.getQueryData(queryKey)
                ? undefined
                : message.loading("Preparing download…", 0)
            const skill = await queryClient
                .fetchQuery({
                    queryKey,
                    queryFn: () => fetchSkillRevisions({projectId, workflowId}),
                    staleTime: 15_000,
                })
                .then((revisions) => revisions[0]?.skill)
                .catch(() => undefined)
                .finally(() => hide?.())
            if (!skill || !downloadSkill(skill)) message.error("Couldn't download this skill")
        },
        [projectId, queryClient],
    )

    return {archive, restore, download}
}
