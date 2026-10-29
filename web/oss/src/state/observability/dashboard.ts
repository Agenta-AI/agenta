import {
    observabilityRangeAtom,
    useObservabilityDashboard as usePackageObservabilityDashboard,
} from "@agenta/observability"
import {useAtomValue} from "jotai"

import {routerAppIdAtom} from "@/oss/state/app/atoms/fetcher"

// The query, its range atom and the analytics transform live in @agenta/observability so the
// mobile app renders the same usage figures. OSS keeps only the router binding below; import
// anything else straight from the package.

/** Historical name — the shared range atom. */
export const observabilityDashboardTimeRangeAtom = observabilityRangeAtom

/** Desktop scopes the figures to the route's app; on project-wide routes that is null. */
export const useObservabilityDashboard = () => {
    const appId = useAtomValue(routerAppIdAtom)
    return usePackageObservabilityDashboard(appId ?? null)
}
