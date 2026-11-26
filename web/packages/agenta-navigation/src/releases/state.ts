import {axios, getAgentaApiUrl, isBillingEnabled} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

import {RELEASES} from "./bundled"
import {
    isVersion,
    latestSecurityRelease,
    mergeReleases,
    newerReleases,
    parseNotices,
    updateSize,
} from "./feed"

import type {InstanceReleases, Notice, Release, UpdateSize, UpgradeMethod} from "./index"

// The API keeps the feed for 12 hours, so asking it at most once an hour is plenty.
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
    // An app left open asks again every hour, so it sees a new release once the API cache
    // (12 hours) has it.
    refetchInterval: STALE_TIME_MS,
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
// an upgrade to make. Without the feed (update check off or feed unreachable) there is no
// upgrade signal either: the bundled notes of a web image newer than the API would show one.
const upgradableVersionAtom = atom<string | null>((get) => {
    if (isBillingEnabled()) return null
    const feedReleases = get(instanceReleasesQueryAtom).data?.releases
    return Array.isArray(feedReleases) && feedReleases.length > 0 ? get(runningVersionAtom) : null
})

/** Releases newer than the running version, which the reader can install. Empty on cloud. */
export const notInstalledReleasesAtom = atom<Release[]>((get) =>
    newerReleases(get(releaseListAtom), get(upgradableVersionAtom)),
)

/** The newest security release the instance is below. Null on cloud. */
export const securityReleaseAtom = atom<Release | null>((get) =>
    latestSecurityRelease(get(releaseListAtom), get(upgradableVersionAtom)),
)

/** How big the newest missing update is (see `updateSize`). Null on cloud or when up to date. */
export const updateSizeAtom = atom<UpdateSize | null>((get) =>
    updateSize(get(notInstalledReleasesAtom), get(upgradableVersionAtom)),
)

const UPGRADE_METHODS: readonly string[] = ["compose", "helm", "railway"] satisfies UpgradeMethod[]

/**
 * How the instance was deployed, when the upgrade box has commands for it. Null for other
 * methods (docker, kubernetes without the chart), when unknown, and on cloud.
 */
export const upgradeMethodAtom = atom<UpgradeMethod | null>((get) => {
    if (isBillingEnabled()) return null
    const method = get(instanceReleasesQueryAtom).data?.deployment_method
    return typeof method === "string" && UPGRADE_METHODS.includes(method)
        ? (method as UpgradeMethod)
        : null
})
