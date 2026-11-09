import {useCallback, useEffect, useMemo, useState} from "react"

import {
    dismissReleaseNotice,
    feedNoticesAtom,
    getDismissedNoticeIds,
    noticeApplies,
    runningVersionAtom,
    type Notice,
} from "@agenta/navigation"
import {axios, getAgentaApiUrl, isEE} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {useQuery} from "@tanstack/react-query"
import {useAtomValue} from "jotai"

/** The plan of an install without the enterprise code (no subscription to read). */
const COMMUNITY_PLAN = "self_hosted_community"

/**
 * The feed notices this instance matches and the reader has not closed. The plan is read only
 * when a notice filters on it, from the subscription query the settings screens share.
 */
export const useReleaseNotices = (): {notices: Notice[]; dismiss: (id: string) => void} => {
    const notices = useAtomValue(feedNoticesAtom)
    const version = useAtomValue(runningVersionAtom)
    const projectId = useAtomValue(projectIdAtom)
    const edition = isEE() ? "ee" : "oss"
    const needsPlan = edition === "ee" && notices.some((notice) => notice.plans)

    const subscription = useQuery({
        queryKey: ["billing", "subscription", projectId],
        queryFn: async () => {
            const {data} = await axios.get<{plan?: string | null} | null>(
                `${getAgentaApiUrl()}/billing/subscription`,
                {params: {project_id: projectId}},
            )
            return data
        },
        enabled: needsPlan && Boolean(projectId),
        staleTime: 1000 * 60 * 5,
        refetchOnWindowFocus: false,
        retry: false,
    })
    const plan = edition === "oss" ? COMMUNITY_PLAN : (subscription.data?.plan ?? null)

    // Storage is not readable during the server render, so nothing shows until mounted.
    const [dismissed, setDismissed] = useState<string[] | null>(null)
    useEffect(() => setDismissed(getDismissedNoticeIds()), [])

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
        setDismissed(getDismissedNoticeIds())
    }, [])

    return {notices: visible, dismiss}
}
