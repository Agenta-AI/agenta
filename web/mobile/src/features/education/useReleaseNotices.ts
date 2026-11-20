import {useCallback, useEffect, useMemo, useState} from "react"

import {
    dismissReleaseNotice,
    getDismissedReleaseNoticeIds,
    noticeApplies,
    releaseNoticesAtom,
    runningVersionAtom,
    type Notice,
} from "@agenta/navigation"
// The subpath keeps the settings screens out of the help menu's load.
import {useBillingSubscription} from "@agenta/settings-ui/entitlements"
import {isEE} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {useAtomValue} from "jotai"

/** The plan of an install without the enterprise code (no subscription to read). */
const COMMUNITY_PLAN = "self_hosted_community"

/**
 * The release notices this instance matches and the reader has not closed. On EE the plan is
 * read only when a notice filters on it, from the subscription query the billing screen uses.
 */
export const useReleaseNotices = (): {notices: Notice[]; dismiss: (id: string) => void} => {
    const notices = useAtomValue(releaseNoticesAtom)
    const version = useAtomValue(runningVersionAtom)
    const projectId = useAtomValue(projectIdAtom)
    const edition = isEE() ? "ee" : "oss"
    const needsPlan = edition === "ee" && notices.some((notice) => notice.plans)

    const subscription = useBillingSubscription({projectId, enabled: needsPlan})
    const plan = edition === "oss" ? COMMUNITY_PLAN : (subscription.data?.plan ?? null)

    // Storage is not readable during the server render, so nothing shows until mounted.
    const [dismissed, setDismissed] = useState<string[] | null>(null)
    useEffect(() => setDismissed(getDismissedReleaseNoticeIds()), [])

    const visible = useMemo(
        () =>
            dismissed === null
                ? []
                : notices.filter(
                      (notice) =>
                          !dismissed.includes(notice.id) &&
                          noticeApplies(notice, {version, edition, plan}),
                  ),
        [dismissed, edition, notices, plan, version],
    )

    const dismiss = useCallback((id: string) => {
        dismissReleaseNotice(id)
        setDismissed(getDismissedReleaseNoticeIds())
    }, [])

    return {notices: visible, dismiss}
}
