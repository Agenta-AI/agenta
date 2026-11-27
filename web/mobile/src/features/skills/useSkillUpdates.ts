import {useCallback} from "react"

import {createT} from "@agenta/i18n"
import skillsListCatalog from "@agenta/i18n/catalogs/skills.list"
import {projectIdAtom} from "@agenta/shared/state"
import {applySkillUpdates, checkSkillUpdates} from "@agenta/skills"
import {invalidateSkillsListCache} from "@agenta/skills/state"
import {message} from "@agenta/ui/app-message"
import {atom, useAtomValue, useSetAtom} from "jotai"
import Router from "next/router"

/** Where an imported skill stands against its upstream, once someone asked. */
export type SkillUpdateStatus = "checking" | "available" | "up_to_date" | "updated" | "failed"

interface StatusEntry {
    status: SkillUpdateStatus
    at: number
}

/** A finished answer older than this is stale and no longer shown. */
const STATUS_TTL_MS = 5 * 60_000

const skillUpdatesAtom = atom<Map<string, StatusEntry>>(new Map())

const fresh = (entry: StatusEntry | undefined): SkillUpdateStatus | undefined =>
    entry && (entry.status === "checking" || Date.now() - entry.at < STATUS_TTL_MS)
        ? entry.status
        : undefined

const tNow = createT(skillsListCatalog)

const CHECK_TOAST = {
    up_to_date: "skills.list.checkUpToDate",
    detached: "skills.list.checkDetached",
    missing_in_source: "skills.list.checkMissing",
    invalid_in_source: "skills.list.checkInvalid",
    check_failed: "skills.list.checkFailed",
} as const

const checkToast = (status: string): string =>
    tNow(
        status in CHECK_TOAST
            ? CHECK_TOAST[status as keyof typeof CHECK_TOAST]
            : CHECK_TOAST.check_failed,
    )

const currentPath = () => Router.asPath.split("?")[0]

export const useSkillUpdateStatus = (workflowId: string): SkillUpdateStatus | undefined =>
    fresh(useAtomValue(skillUpdatesAtom).get(workflowId))

/** The ids among `ids` an update is known to be waiting for. */
export const useSkillsWithUpdates = (ids: string[]): string[] => {
    const statuses = useAtomValue(skillUpdatesAtom)
    return ids.filter((id) => fresh(statuses.get(id)) === "available")
}

/** True while any of `ids` is being checked or applied. */
export const useSkillUpdatesBusy = (ids: string[]): boolean => {
    const statuses = useAtomValue(skillUpdatesAtom)
    return ids.some((id) => statuses.get(id)?.status === "checking")
}

export const useSkillUpdates = () => {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const setStatuses = useSetAtom(skillUpdatesAtom)

    const mark = useCallback(
        (entries: [string, SkillUpdateStatus][]) =>
            setStatuses((current) => {
                const next = new Map(current)
                const at = Date.now()
                for (const [id, status] of entries) next.set(id, {status, at})
                return next
            }),
        [setStatuses],
    )

    /** Read-only: asks upstream where each skill stands; the result toast replaces a "Checking…" one. */
    const check = useCallback(
        async (ids: string[]) => {
            if (!ids.length) return
            const key = `skill-check-${ids.join(",")}`
            const startedOn = currentPath()
            mark(ids.map((id): [string, SkillUpdateStatus] => [id, "checking"]))
            message.loading({content: tNow("skills.list.checkingUpdates"), key, duration: 0})
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
            // Detachment is derived server-side; a check can change what the list shows.
            invalidateSkillsListCache()
            // The reader left the screen that asked: no late toast on another page.
            if (currentPath() !== startedOn) {
                message.destroy(key)
                return
            }
            const available = results.filter(({status}) => status === "update_available")
            const content =
                results.length === 1
                    ? available.length
                        ? tNow("skills.list.updateAvailable")
                        : checkToast(results[0].status)
                    : available.length
                      ? tNow("skills.list.updatesAvailable", {count: available.length})
                      : tNow("skills.list.allUpToDate")
            message.info({content, key})
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
                message.success(tNow("skills.list.skillsUpdated", {count: applied.length}))
                invalidateSkillsListCache()
            }
            if (failed.length)
                message.error(tNow("skills.list.updateFailed", {count: failed.length}))
        },
        [mark, projectId],
    )

    return {check, apply}
}
