import duration from "dayjs/plugin/duration"
import relativeTime from "dayjs/plugin/relativeTime"
import {atom} from "jotai"

import {BannerConfig} from "@/oss/components/SidebarBanners/types"
import dayjs from "@/oss/lib/helpers/dateTimeHelper/dayjs"
import {isDemo} from "@/oss/lib/helpers/utils"
import {Plan} from "@/oss/lib/Types"

import {subscriptionQueryAtom} from "../../../state/billing/atoms"

dayjs.extend(duration)
dayjs.extend(relativeTime)

/**
 * Helper to get trial time remaining text.
 */
const getTrialTimeText = (periodEnd: number): string => {
    const end = dayjs.unix(periodEnd)
    const now = dayjs()

    const isFuture = end.isAfter(now)
    const diffHumanized = dayjs.duration(Math.abs(end.diff(now))).humanize(false)

    return isFuture ? `Trial ends in ${diffHumanized}` : `Trial ended ${diffHumanized} ago`
}

/**
 * Helper to get plan display name from plan key.
 */
const getPlanDisplayName = (plan: string): string => {
    // Plan format: cloud_v0_pro -> Pro
    const parts = plan?.split("_")
    if (parts && parts.length >= 3) {
        return parts[2].charAt(0).toUpperCase() + parts[2].slice(1)
    }
    return "Pro"
}

/**
 * Computed atom for EE-specific banners.
 * Returns subscription-based banners only when running in demo/cloud mode.
 */
export const eeBannersAtom = atom((get): BannerConfig[] => {
    // Only show billing banners in cloud/demo environment
    if (!isDemo()) {
        return []
    }

    const subscriptionQuery = get(subscriptionQueryAtom)
    const subscription = subscriptionQuery.data

    // Don't show banners while loading or if no subscription data
    if (!subscription) {
        return []
    }

    const banners: BannerConfig[] = []

    // Trial banner (non-dismissible) - highest priority
    if (subscription.free_trial) {
        const planName = getPlanDisplayName(subscription.plan)
        const trialText = getTrialTimeText(subscription.period_end)

        banners.push({
            id: "trial-banner",
            type: "trial",
            dismissible: false,
            title: `${planName} Trial`,
            description: `${trialText}. Upgrade today to keep pro plan features.`,
            action: {
                label: "Upgrade now",
                href: "/settings?tab=billing",
            },
        })
    }
    // Upgrade banner (dismissible) - only if NOT on trial AND on Hobby plan
    else if (subscription.plan === Plan.Hobby) {
        banners.push({
            id: "upgrade-banner-v1",
            type: "upgrade",
            dismissible: true,
            title: "Free Plan",
            description:
                "Create unlimited applications & run unlimited evaluations. Upgrade today and get more out of Agenta.",
            action: {
                label: "Upgrade",
                href: "/settings?tab=billing",
            },
        })
    }
    // No billing banners for Pro/Business/Enterprise users

    return banners
})
