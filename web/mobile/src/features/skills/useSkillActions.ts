import {useCallback} from "react"

import {downloadSkill} from "@agenta/entity-ui/drill-in"
import {projectIdAtom} from "@agenta/shared/state"
import {fetchSkillRevisions, unarchiveSkill} from "@agenta/skills"
import {invalidateSkillsListCache} from "@agenta/skills/state"
import {skillRevisionsQueryKey} from "@agenta/skills-ui"
import {message} from "@agenta/ui/app-message"
import {useQueryClient} from "@tanstack/react-query"
import {useAtomValue} from "jotai"

/** The registry verbs a row and the selection bar run. */
export const useSkillActions = () => {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const queryClient = useQueryClient()

    const restore = useCallback(
        async (workflowIds: string[]) => {
            const results = await Promise.allSettled(
                workflowIds.map((workflowId) => unarchiveSkill({projectId, workflowId})),
            )
            invalidateSkillsListCache()
            const done = results.filter((result) => result.status === "fulfilled").length
            if (done < workflowIds.length) message.error("Could not restore every skill")
            else
                message.success(
                    done === 1
                        ? "The skill is restored. Agents can use it again."
                        : `${done} skills are restored. Agents can use them again.`,
                )
        },
        [projectId],
    )

    const download = useCallback(
        async (workflowId: string) => {
            const hide = message.loading("Preparing download…", 0)
            const skill = await queryClient
                .fetchQuery({
                    queryKey: skillRevisionsQueryKey(projectId, workflowId),
                    queryFn: () => fetchSkillRevisions({projectId, workflowId}),
                    staleTime: 0,
                })
                .then((revisions) => revisions[0]?.skill)
                .catch(() => undefined)
                .finally(() => hide())
            if (!skill || !downloadSkill(skill)) message.error("Could not download this skill")
        },
        [projectId, queryClient],
    )

    return {restore, download}
}
