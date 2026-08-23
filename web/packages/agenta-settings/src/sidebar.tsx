import type {ReactNode} from "react"

import type {SidebarConfig, SidebarSection, SidebarSlotContext} from "@agenta/navigation"
import {
    Buildings,
    ClockCounterClockwise,
    FolderSimple,
    Key,
    Lightning,
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

/** The one tab→icon map. A new tab fails the exhaustive check here until it has an icon. */
export const getSettingsSidebarIcon = (key: SettingsTabKey): ReactNode => {
    switch (key) {
        case "apiKeys":
            return <Key size={14} />
        case "secrets":
            return <Vault size={14} />
        case "llms":
            return <Sparkle size={14} />
        case "tools":
            return <Wrench size={14} />
        case "triggers":
            return <Lightning size={14} />
        case "webhooks":
            return <Link size={14} />
        case "workspace":
            return <UsersThree size={14} />
        case "organizationGeneral":
            return <Buildings size={14} />
        case "organization":
            return <ShieldCheck size={14} />
        case "auditLog":
            return <ClockCounterClockwise size={14} />
        case "billing":
            return <Receipt size={14} />
        case "account":
            return <User size={14} />
        case "preferences":
            return <SlidersHorizontal size={14} />
        case "projects":
            return <FolderSimple size={14} />
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

    return SETTINGS_SCOPES.map(({key, title}, index) => ({
        key: `settings-${key}`,
        items: itemsByScope[key],
        // Groups are separated by whitespace, not a rule.
        dividerBefore: false,
        before: ({collapsed}: SidebarSlotContext) =>
            collapsed ? null : (
                // pl-[22px] = menu items' mx-2 + pl-3 (20px), nudged 2px right.
                <div
                    className={[
                        "pl-[22px] pr-3 pb-1 text-xs font-medium text-colorTextTertiary",
                        index === 0 ? "pt-1" : "pt-4",
                    ].join(" ")}
                >
                    {title}
                </div>
            ),
    }))
}
