import {axios, getAgentaApiUrl, isBillingEnabled} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

import {isVersion, latestSecurityRelease, mergeReleases, newerReleases, parseNotices} from "./feed"

import {RELEASES, type InstanceReleases, type Notice, type Release} from "./index"

// The API refreshes the feed every 12 hours, so once per page load is plenty.
const STALE_TIME_MS = 60 * 60 * 1000

/**
 * `GET /instance/releases`. Any failure leaves `data` empty, and every reader below then falls
 * back to the bundled list, which is today's behavior. Waits for a project, i.e. a signed-in user.
 */
export const instanceReleasesQueryAtom = atomWithQuery<InstanceReleases | null>((get) => ({
    queryKey: ["instance", "releases"],
    queryFn: async () => {
        try {
            const {data} = await axios.get<InstanceReleases>(
                `${getAgentaApiUrl()}/instance/releases`,
            )
            return data ?? null
        } catch {
            return null
        }
    },
    enabled: Boolean(get(projectIdAtom)),
    staleTime: STALE_TIME_MS,
    refetchOnWindowFocus: false,
    retry: false,
}))

/** The bundled releases plus the newer ones the feed lists, newest first. */
export const releaseListAtom = atom<Release[]>((get) => {
    const releases = get(instanceReleasesQueryAtom).data?.releases
    return Array.isArray(releases) ? mergeReleases(RELEASES, releases) : RELEASES
})

/** The feed's well-formed release notices, before any filter. */
export const releaseNoticesAtom = atom<Notice[]>((get) => {
    const notices = get(instanceReleasesQueryAtom).data?.notices
    return Array.isArray(notices) ? parseNotices(notices) : []
})

/** The version the API runs, or null until it answers (or when it cannot say). */
export const runningVersionAtom = atom<string | null>((get) => {
    const version = get(instanceReleasesQueryAtom).data?.version
    return isVersion(version) ? version : null
})

// Cloud (billing on) is upgraded by Agenta, so its readers see newer release notes but never
// an upgrade to make.
const upgradableVersionAtom = atom<string | null>((get) =>
    isBillingEnabled() ? null : get(runningVersionAtom),
)

/** Releases newer than the running version, which the reader can install. Empty on cloud. */
export const notInstalledReleasesAtom = atom<Release[]>((get) =>
    newerReleases(get(releaseListAtom), get(upgradableVersionAtom)),
)

/** The newest security release the instance is below. Null on cloud. */
export const securityReleaseAtom = atom<Release | null>((get) =>
    latestSecurityRelease(get(releaseListAtom), get(upgradableVersionAtom)),
)
