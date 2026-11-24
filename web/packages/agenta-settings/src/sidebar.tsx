import type {ReactNode} from "react"

import {createT} from "@agenta/i18n"
import navigationCatalog from "@agenta/i18n/catalogs/navigation"
import type {SidebarConfig, SidebarSection, SidebarSlotContext} from "@agenta/navigation"
import {
    Broadcast,
    Buildings,
    ChartLineUp,
    Coins,
    ClockCounterClockwise,
    FolderSimple,
    HardDrives,
    Key,
    Link,
    Receipt,
    ShieldCheck,
    SlidersHorizontal,
    Sparkle,
    User,
    UsersThree,
    Vault,
    Wrench,
} from "@phosphor-icons/react"

import {SETTINGS_SCOPES, type SettingsScopeKey, type SettingsTabKey} from "./navigation"

const t = createT(navigationCatalog)

/** The one tab→icon map. A new tab fails the exhaustive check here until it has an icon. */
export const getSettingsSidebarIcon = (key: SettingsTabKey): ReactNode => {
    switch (key) {
        case "apiKeys":
            return <Key size={16} />
        case "secrets":
            return <Vault size={16} />
        case "llms":
            return <Sparkle size={16} />
        case "analytics":
            return <ChartLineUp size={16} />
        case "tools":
            return <Wrench size={16} />
        case "channels":
            return <Broadcast size={16} />
        case "webhooks":
            return <Link size={16} />
        case "mcpEndpoints":
            return <HardDrives size={16} />
        case "workspace":
            return <UsersThree size={16} />
        case "organizationGeneral":
            return <Buildings size={16} />
        case "organization":
            return <ShieldCheck size={16} />
        case "auditLog":
            return <ClockCounterClockwise size={16} />
        case "billing":
            return <Receipt size={16} />
        case "credits":
            return <Coins size={16} />
        case "account":
            return <User size={16} />
        case "preferences":
            return <SlidersHorizontal size={16} />
        case "projects":
            return <FolderSimple size={16} />
        default: {
            const exhaustiveCheck: never = key
            return exhaustiveCheck
        }
    }
}

/** What a host feeds the builder — the shape `getSettingsSidebarTabs(access)` already returns. */
export interface SettingsSidebarTab {
    key: SettingsTabKey
    scope: SettingsScopeKey
    title: string
    isHidden?: boolean
}

export interface SettingsSidebarSectionsOptions {
    /** A tab's href. Omit for a rail that is purely controlled (the desktop's). */
    getLink?: (key: SettingsTabKey) => string
}

/**
 * The settings rail's sections — one group per `SETTINGS_SCOPES` entry, in that order, each
 * headed by the scope title. Headless: the host owns selection, routing and the bottom section.
 */
export const buildSettingsSidebarSections = (
    tabs: SettingsSidebarTab[],
    {getLink}: SettingsSidebarSectionsOptions = {},
): SidebarSection[] => {
    const itemsByScope: Record<SettingsScopeKey, SidebarConfig[]> = {
        connections: [],
        project: [],
        organization: [],
        personal: [],
    }

    tabs.forEach(({key, scope, title, isHidden}) => {
        itemsByScope[scope].push({
            key,
            title,
            icon: getSettingsSidebarIcon(key),
            isHidden,
            link: getLink?.(key),
        })
    })

    return SETTINGS_SCOPES.map(({key, titleKey}, index) => ({
        key: `settings-${key}`,
        items: itemsByScope[key],
        // Groups are separated by whitespace, not a rule.
        dividerBefore: false,
        before: ({collapsed}: SidebarSlotContext) =>
            collapsed ? (
                <div className="my-1 h-px w-full shrink-0 bg-[var(--ag-shell-line)]" />
            ) : (
                // pl-5 = the rows' 8px inset + their 12px padding.
                <div
                    className={[
                        "pl-5 pr-3 pb-1 text-meta leading-5 text-muted-foreground",
                        index === 0 ? "pt-1" : "pt-4",
                    ].join(" ")}
                >
                    {t(titleKey)}
                </div>
            ),
    }))
}
