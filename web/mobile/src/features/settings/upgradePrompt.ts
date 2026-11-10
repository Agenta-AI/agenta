import {useEffect, useRef} from "react"

import {isBillingEnabled, isEE} from "@agenta/shared/api"

import {capture} from "@/features/analytics/client"

/** The enterprise features a locked settings section stands in for (the API's `Flag` values). */
export type UpgradeFeature = "access" | "audit" | "domains" | "sso"
/** The settings tab that shows the locked section. */
export type UpgradeScreen = "organization" | "auditLog"
export type UpgradeAction = "get_free_key" | "add_license_key" | "upgrade_docs" | "talk_to_us"

export const UPGRADE_DOCS_URL = "https://docs.agenta.ai/self-host/upgrades/oss-to-ee-switch"
export const CONTACT_URL = "https://agenta.ai/contact"
export const contactUrl = (feature: UpgradeFeature) => `${CONTACT_URL}?feature=${feature}`

/**
 * The actions a locked section offers on a self-hosted instance, in display order.
 * `get_free_key` joins when the registered plan includes a feature; no plan does yet.
 */
export const availableUpgradeActions = (enterprise: boolean): UpgradeAction[] => [
    enterprise ? "add_license_key" : "upgrade_docs",
    "talk_to_us",
]

export interface UpgradePrompt {
    /** Self-hosted (no billing). Cloud keeps its plan notice and sends no upgrade events. */
    selfHosted: boolean
    actions: UpgradeAction[]
}

/**
 * The locked state of one enterprise feature: which actions apply, and the
 * `upgrade_prompt_viewed` event each time it is shown. `capture` sends nothing
 * when the instance has telemetry off.
 */
export const useUpgradePrompt = ({
    feature,
    screen,
    shown,
}: {
    feature: UpgradeFeature
    screen: UpgradeScreen
    shown: boolean
}): UpgradePrompt => {
    const selfHosted = !isBillingEnabled()
    // One event per view: StrictMode runs the effect twice in development.
    const viewed = useRef(false)

    useEffect(() => {
        if (!shown || !selfHosted) {
            viewed.current = false
            return
        }
        if (viewed.current) return
        viewed.current = true
        capture("upgrade_prompt_viewed", {feature, screen})
    }, [shown, selfHosted, feature, screen])

    return {selfHosted, actions: selfHosted ? availableUpgradeActions(isEE()) : []}
}

export const captureUpgradeClick = (
    feature: UpgradeFeature,
    screen: UpgradeScreen,
    action: UpgradeAction,
) => capture("upgrade_prompt_clicked", {feature, screen, action})

/** The line under a self-hosted locked section; cloud keeps the plan names. */
export const SELF_HOSTED_AVAILABILITY = "Available with an Enterprise license."
