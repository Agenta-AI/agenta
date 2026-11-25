import type {ReactNode} from "react"

import {useT, type CatalogKey} from "@agenta/i18n"
import settingsAccessCatalog from "@agenta/i18n/catalogs/settings.access"
import {getSettingsSidebarIcon} from "@agenta/settings"

import {UpgradeNotice} from "./UpgradeNotice"

/** The three separately-sold halves of Access & Security. */
export type AccessFeature = "access" | "domains" | "sso"

const FEATURES: Record<
    AccessFeature,
    {
        name: CatalogKey<typeof settingsAccessCatalog>
        blurb: CatalogKey<typeof settingsAccessCatalog>
    }
> = {
    access: {
        name: "settings.access.accessControls",
        blurb: "settings.access.accessControlsBlurb",
    },
    domains: {
        name: "settings.access.verifiedDomains",
        blurb: "settings.access.verifiedDomainsBlurb",
    },
    sso: {
        name: "settings.access.ssoProviders",
        blurb: "settings.access.ssoBlurb",
    },
}

const ORDER: AccessFeature[] = ["access", "domains", "sso"]

/** "a", "a and b", "a, b and c" — the last separator is "and", not a comma. */
const list = (t: ReturnType<typeof useT>, parts: string[]) =>
    parts.length <= 1
        ? (parts[0] ?? "")
        : parts.length === 2
          ? t("settings.access.listTwo", {first: parts[0], second: parts[1]})
          : t("settings.access.listThree", {first: parts[0], second: parts[1], third: parts[2]})

export interface AccessUpgradeNoticeProps {
    /** Which features the plan does not include. Renders nothing when empty. */
    locked: AccessFeature[]
    /** The upgrade link — routing and billing availability are the host's to decide. */
    action?: ReactNode
}

/**
 * ONE locked panel for however many Access & Security features the plan excludes.
 *
 * Three identical lock cards stacked down the page said nothing three times; a plan that
 * includes none of this has one thing to say, so it says it once and names what is missing.
 */
export const AccessUpgradeNotice = ({locked, action}: AccessUpgradeNoticeProps) => {
    const t = useT(settingsAccessCatalog)
    if (locked.length === 0) return null

    const present = ORDER.filter((feature) => locked.includes(feature))
    const isEverything = present.length === ORDER.length

    return (
        <UpgradeNotice
            icon={getSettingsSidebarIcon("organization")}
            title={
                isEverything
                    ? t("settings.access.allNotAvailable")
                    : t("settings.access.featuresNotAvailable", {
                          count: present.length,
                          features: list(
                              t,
                              present.map((feature) => t(FEATURES[feature].name)),
                          ),
                      })
            }
            description={t("settings.access.setUpFeatures", {
                features: list(
                    t,
                    present.map((feature) => t(FEATURES[feature].blurb)),
                ),
            })}
            action={action}
        />
    )
}

export default AccessUpgradeNotice
