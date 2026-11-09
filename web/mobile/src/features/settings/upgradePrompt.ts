import {useEffect} from "react"

import {fetchAccessPlans, useBillingSubscription} from "@agenta/settings-ui"
import {isBillingEnabled, isEE} from "@agenta/shared/api"
import {useQuery} from "@tanstack/react-query"

import {capture} from "@/features/analytics/client"

/** The enterprise features a locked settings section stands in for (the API's `Flag` values). */
export type UpgradeFeature = "access" | "audit" | "domains" | "sso"
/** The settings tab that shows the locked section. */
export type UpgradeScreen = "organization" | "auditLog"
export type UpgradeAction = "get_free_key" | "add_license_key" | "upgrade_docs" | "talk_to_us"

export const UPGRADE_DOCS_URL = "https://docs.agenta.ai/self-host/upgrades/oss-to-ee-switch"
export const CONTACT_URL = "https://agenta.ai/contact"
export const contactUrl = (feature: UpgradeFeature) => `${CONTACT_URL}?feature=${feature}`

const COMMUNITY_PLAN = "self_hosted_community"
const REGISTERED_PLAN = "self_hosted_registered"

/** The actions a locked section offers on a self-hosted instance, in display order. */
export const upgradeActions = ({
    enterprise,
    freeKeyUnlocks,
}: {
    enterprise: boolean
    freeKeyUnlocks: boolean
}): UpgradeAction[] => [
    ...(freeKeyUnlocks ? (["get_free_key"] as const) : []),
    enterprise ? "add_license_key" : "upgrade_docs",
    "talk_to_us",
]

export interface UpgradePrompt {
    /** Self-hosted (no billing). Cloud keeps its plan notice and sends no upgrade events. */
    selfHosted: boolean
    actions: UpgradeAction[]
    freeKeyUnlocks: boolean
}

/**
 * The locked state of one enterprise feature: which actions apply, and the
 * `upgrade_prompt_viewed` event each time it is shown. `capture` sends nothing
 * when the instance has telemetry off.
 */
export const useUpgradePrompt = ({
    feature,
    screen,
    projectId,
    shown,
}: {
    feature: UpgradeFeature
    screen: UpgradeScreen
    projectId: string
    shown: boolean
}): UpgradePrompt => {
    const selfHosted = !isBillingEnabled()
    const enterprise = isEE()
    // The registered plan unlocks a feature only when the plan table says so; the OSS image has
    // no plan table and cannot use a key, so it never offers one. Both reads share the
    // entitlement cache, so they add no request.
    const asksPlans = shown && selfHosted && enterprise
    const plans = useQuery({
        queryKey: ["access", "plans"],
        queryFn: fetchAccessPlans,
        staleTime: 1000 * 60 * 10,
        enabled: asksPlans && Boolean(projectId),
    })
    const subscription = useBillingSubscription({projectId, enabled: asksPlans})
    const freeKeyUnlocks =
        asksPlans &&
        subscription.data?.plan === COMMUNITY_PLAN &&
        Boolean(plans.data?.[REGISTERED_PLAN]?.flags?.[feature])

    useEffect(() => {
        if (shown && selfHosted) capture("upgrade_prompt_viewed", {feature, screen})
    }, [shown, selfHosted, feature, screen])

    return {
        selfHosted,
        actions: selfHosted ? upgradeActions({enterprise, freeKeyUnlocks}) : [],
        freeKeyUnlocks,
    }
}

export const captureUpgradeClick = (
    feature: UpgradeFeature,
    screen: UpgradeScreen,
    action: UpgradeAction,
) => capture("upgrade_prompt_clicked", {feature, screen, action})

/** The line under a self-hosted locked section; cloud keeps the plan names. */
export const upgradeAvailability = ({freeKeyUnlocks}: UpgradePrompt) =>
    freeKeyUnlocks ? "Available with a free key." : "Available with an Enterprise license."
