import {useCallback, useEffect, useMemo, useState} from "react"

import {
    dismissReleaseNotice,
    getDismissedReleaseNoticeIds,
    noticeApplies,
    releaseNoticesAtom,
    runningVersionAtom,
    type Notice,
} from "@agenta/navigation"
import {isEE} from "@agenta/shared/api"
import {useAtomValue} from "jotai"

/** The release notices this instance matches and the reader has not closed. */
export const useReleaseNotices = (): {notices: Notice[]; dismiss: (id: string) => void} => {
    const notices = useAtomValue(releaseNoticesAtom)
    const version = useAtomValue(runningVersionAtom)
    const edition = isEE() ? "ee" : "oss"

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
                          noticeApplies(notice, {version, edition}),
                  ),
        [dismissed, edition, notices, version],
    )

    const dismiss = useCallback((id: string) => {
        dismissReleaseNotice(id)
        setDismissed(getDismissedReleaseNoticeIds())
    }, [])

    return {notices: visible, dismiss}
}
