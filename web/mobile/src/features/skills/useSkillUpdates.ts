import {useCallback} from "react"

import {projectIdAtom} from "@agenta/shared/state"
import {applySkillUpdates, checkSkillUpdates} from "@agenta/skills"
import {invalidateSkillsListCache} from "@agenta/skills/state"
import {message} from "@agenta/ui/app-message"
import {atom, useAtomValue, useSetAtom} from "jotai"

/**
 * Where an imported skill stands against its upstream, once someone asked.
 *
 * `available` is the one that changes what is on screen: the row grows an Update button and the
 * group heading counts it. The rest are the answer to "Check for updates", said once as a toast.
 */
export type SkillUpdateStatus = "checking" | "available" | "up_to_date" | "updated" | "failed"

/**
 * One map for the whole screen, so a group heading and the rows under it read the same answer
 * without the screen threading it through the table. Module-scoped, not persisted: an update
 * check is a question asked now, and the next visit asks again.
 */
const skillUpdatesAtom = atom<Map<string, SkillUpdateStatus>>(new Map())

const CHECK_TOAST: Record<string, string> = {
    up_to_date: "Up to date",
    detached: "Modified locally — updates are kept off it",
    missing_in_source: "No longer in the source repository",
    invalid_in_source: "The upstream copy is not a valid skill",
    check_failed: "Couldn't check for updates",
}

export const useSkillUpdateStatus = (workflowId: string): SkillUpdateStatus | undefined =>
    useAtomValue(skillUpdatesAtom).get(workflowId)

/** The ids among `ids` an update is known to be waiting for. */
export const useSkillsWithUpdates = (ids: string[]): string[] => {
    const statuses = useAtomValue(skillUpdatesAtom)
    return ids.filter((id) => statuses.get(id) === "available")
}

/** True while any of `ids` is being checked or applied. */
export const useSkillUpdatesBusy = (ids: string[]): boolean => {
    const statuses = useAtomValue(skillUpdatesAtom)
    return ids.some((id) => statuses.get(id) === "checking")
}

export const useSkillUpdates = () => {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const setStatuses = useSetAtom(skillUpdatesAtom)

    const mark = useCallback(
        (entries: [string, SkillUpdateStatus][]) =>
            setStatuses((current) => {
                const next = new Map(current)
                for (const [id, status] of entries) next.set(id, status)
                return next
            }),
        [setStatuses],
    )

    /**
     * Read-only: asks upstream where each skill stands. A single skill's answer is said aloud;
     * a group's is only shown through what changes on the rows.
     */
    const check = useCallback(
        async (ids: string[]) => {
            if (!ids.length) return
            mark(ids.map((id): [string, SkillUpdateStatus] => [id, "checking"]))
            const results = await checkSkillUpdates({projectId, workflowIds: ids})
            mark(
                results.map(({workflowId, status}): [string, SkillUpdateStatus] => [
                    workflowId,
                    status === "update_available"
                        ? "available"
                        : status === "up_to_date"
                          ? "up_to_date"
                          : "failed",
                ]),
            )
            if (results.length === 1) {
                const {status} = results[0]
                if (status === "update_available") message.info("An update is available")
                else message.info(CHECK_TOAST[status] ?? CHECK_TOAST.check_failed)
            } else {
                const available = results.filter(({status}) => status === "update_available")
                message.info(
                    available.length
                        ? `${available.length} ${available.length === 1 ? "update" : "updates"} available`
                        : "All up to date",
                )
            }
            // Detachment is derived server-side; a check can change what the list shows.
            invalidateSkillsListCache()
        },
        [mark, projectId],
    )

    /** Commits the upstream version of each skill as a new revision. */
    const apply = useCallback(
        async (ids: string[]) => {
            if (!ids.length) return
            mark(ids.map((id): [string, SkillUpdateStatus] => [id, "checking"]))
            const {applied, failed} = await applySkillUpdates({projectId, workflowIds: ids})
            mark([
                ...applied.map((id): [string, SkillUpdateStatus] => [id, "updated"]),
                // What did not apply stays offered, so a retry is one press away.
                ...failed.map((id): [string, SkillUpdateStatus] => [id, "available"]),
            ])
            if (applied.length) {
                message.success(
                    applied.length === 1 ? "Skill updated" : `${applied.length} skills updated`,
                )
                invalidateSkillsListCache()
            }
            if (failed.length)
                message.error(
                    failed.length === 1
                        ? "Couldn't update 1 skill"
                        : `Couldn't update ${failed.length} skills`,
                )
        },
        [mark, projectId],
    )

    return {check, apply}
}
