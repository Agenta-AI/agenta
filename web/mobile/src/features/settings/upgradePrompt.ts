import {useEffect, useRef} from "react"

import {isBillingEnabled} from "@agenta/shared/api"

import {capture} from "@/features/analytics/client"

/** The enterprise features a locked settings section stands in for (the API's `Flag` values). */
export type UpgradeFeature = "access" | "audit" | "domains" | "sso"
/** The settings tab that shows the locked section. */
export type UpgradeScreen = "organization" | "auditLog"
export type UpgradeAction = "add_license_key" | "talk_to_us"

export const CONTACT_URL = "https://agenta.ai/contact"
export const PRICING_URL = "https://agenta.ai/pricing"
export const FREE_KEY_DOCS_URL =
    "https://docs.agenta.ai/self-host/license-keys#get-a-free-registration-key"
export const contactUrl = (feature: UpgradeFeature) => `${CONTACT_URL}?feature=${feature}`

/** The actions a locked section offers on a self-hosted instance, in display order. */
export const availableUpgradeActions = (): UpgradeAction[] => ["talk_to_us", "add_license_key"]

/**
 * One `upgrade_prompt_viewed` event per locked feature each time the box mounts.
 * `capture` sends nothing when the instance has telemetry off.
 */
export const useUpgradePromptViewed = (features: UpgradeFeature[], screen: UpgradeScreen) => {
    // One event per view: StrictMode runs the effect twice in development.
    const viewed = useRef(false)
    const key = features.join(",")

    useEffect(() => {
        if (viewed.current || isBillingEnabled()) return
        viewed.current = true
        for (const feature of key.split(",")) capture("upgrade_prompt_viewed", {feature, screen})
    }, [key, screen])
}

export const captureUpgradeClick = (
    feature: UpgradeFeature,
    screen: UpgradeScreen,
    action: UpgradeAction,
) => capture("upgrade_prompt_clicked", {feature, screen, action})
