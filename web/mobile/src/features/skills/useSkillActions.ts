import {useCallback} from "react"

import {downloadSkill} from "@agenta/entity-ui/drill-in"
import {createT} from "@agenta/i18n"
import skillsListCatalog from "@agenta/i18n/catalogs/skills.list"
import {projectIdAtom} from "@agenta/shared/state"
import {archiveSkill, fetchSkillRevisions, unarchiveSkill} from "@agenta/skills"
import {invalidateSkillsListCache} from "@agenta/skills/state"
import {skillRevisionsQueryKey} from "@agenta/skills-ui"
import {message} from "@agenta/ui/app-message"
import {useQueryClient} from "@tanstack/react-query"
import {useAtomValue} from "jotai"

const tNow = createT(skillsListCatalog)

/** The registry verbs a row's kebab and the skill page run. */
export const useSkillActions = () => {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const queryClient = useQueryClient()

    const archive = useCallback(
        async (workflowId: string) => {
            await archiveSkill({projectId, workflowId})
            invalidateSkillsListCache()
            message.success(tNow("skills.list.archived"))
        },
        [projectId],
    )

    const restore = useCallback(
        async (workflowId: string) => {
            try {
                await unarchiveSkill({projectId, workflowId})
                invalidateSkillsListCache()
                message.success(tNow("skills.list.restored"))
            } catch {
                message.error(tNow("skills.list.restoreFailed"))
            }
        },
        [projectId],
    )

    // Every call runs; the list refreshes once, and a failure names how many did not go through.
    const archiveMany = useCallback(
        async (workflowIds: string[]) => {
            const results = await Promise.allSettled(
                workflowIds.map((workflowId) => archiveSkill({projectId, workflowId})),
            )
            invalidateSkillsListCache()
            const failed = results.filter((result) => result.status === "rejected").length
            if (failed) message.error(tNow("skills.list.bulkArchiveFailed", {count: failed}))
            else message.success(tNow("skills.list.bulkArchived", {count: workflowIds.length}))
        },
        [projectId],
    )

    const restoreMany = useCallback(
        async (workflowIds: string[]) => {
            const results = await Promise.allSettled(
                workflowIds.map((workflowId) => unarchiveSkill({projectId, workflowId})),
            )
            invalidateSkillsListCache()
            const failed = results.filter((result) => result.status === "rejected").length
            if (failed) message.error(tNow("skills.list.bulkRestoreFailed", {count: failed}))
            else message.success(tNow("skills.list.bulkRestored", {count: workflowIds.length}))
        },
        [projectId],
    )

    // One toast per download: "Preparing…" turns into the result in place.
    const download = useCallback(
        async (workflowId: string) => {
            const key = `skill-download-${workflowId}`
            message.loading({content: tNow("skills.list.preparingDownload"), key, duration: 0})
            const skill = await queryClient
                .fetchQuery({
                    queryKey: skillRevisionsQueryKey(projectId, workflowId),
                    queryFn: () => fetchSkillRevisions({projectId, workflowId}),
                    // Always the server's head: a cached one can predate another user's save.
                    staleTime: 0,
                })
                .then((revisions) => revisions[0]?.skill)
                .catch(() => undefined)
            if (skill && downloadSkill(skill))
                message.success({content: tNow("skills.list.downloaded"), key})
            else message.error({content: tNow("skills.list.downloadFailed"), key})
        },
        [projectId, queryClient],
    )

    return {archive, restore, archiveMany, restoreMany, download}
}
