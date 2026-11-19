import {useCallback} from "react"

import {downloadSkill} from "@agenta/entity-ui/drill-in"
import {projectIdAtom} from "@agenta/shared/state"
import {fetchSkillRevisions} from "@agenta/skills"
import {restoreSkills, skillRevisionsQueryKey} from "@agenta/skills-ui"
import {message} from "@agenta/ui/app-message"
import {useQueryClient} from "@tanstack/react-query"
import {useAtomValue} from "jotai"

/** The registry verbs a row and the selection bar run. */
export const useSkillActions = () => {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const queryClient = useQueryClient()

    const restore = useCallback(
        (workflowIds: string[]) => restoreSkills(projectId, workflowIds),
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
