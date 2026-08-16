import {useMemo} from "react"

import {getSettingsSidebarTabs, SETTINGS_SCOPES, type SettingsTabKey} from "@agenta/settings"

import {cn} from "@/lib/utils"

import {AVAILABLE_SETTINGS_TABS, useMobileSettingsAccess} from "./settingsTabs"

/**
 * The NESTED settings rail — a second rail beside the main one, behind
 * `NEXT_PUBLIC_SETTINGS_NESTED_NAV`. Off by default: settings takes over the main sidebar
 * instead, as oss/ee do. Grouping and labels come from `@agenta/settings` either way.
 */
export const SettingsTabRail = ({
    active,
    onSelect,
}: {
    active: SettingsTabKey | null
    onSelect: (tab: SettingsTabKey) => void
}) => {
    const access = useMobileSettingsAccess()

    const groups = useMemo(() => {
        const tabs = getSettingsSidebarTabs(access).filter(
            (tab) => AVAILABLE_SETTINGS_TABS.includes(tab.key) && !tab.isHidden,
        )
        return SETTINGS_SCOPES.map((scope) => ({
            ...scope,
            tabs: tabs.filter((tab) => tab.scope === scope.key),
        })).filter((scope) => scope.tabs.length > 0)
    }, [access])

    return (
        // A scrolling strip on a phone, a grouped rail from lg.
        <nav className="border-border flex shrink-0 gap-1 overflow-x-auto border-0 border-b border-solid px-2 py-2 lg:w-[220px] lg:flex-col lg:gap-4 lg:overflow-y-auto lg:border-b-0 lg:border-r lg:px-3 lg:py-4">
            {groups.map((group) => (
                <div key={group.key} className="flex gap-1 lg:flex-col">
                    <span className="text-muted-foreground hidden px-2 pb-1 text-[11px] font-medium uppercase tracking-wide lg:block">
                        {group.title}
                    </span>
                    {group.tabs.map((tab) => (
                        <button
                            key={tab.key}
                            type="button"
                            onClick={() => onSelect(tab.key)}
                            className={cn(
                                "shrink-0 cursor-pointer rounded-md border-0 px-3 py-1.5 text-left text-xs",
                                tab.key === active
                                    ? "bg-accent text-accent-foreground font-medium"
                                    : "text-muted-foreground hover:bg-accent/50 bg-transparent",
                            )}
                        >
                            {tab.title}
                        </button>
                    ))}
                </div>
            ))}
        </nav>
    )
}
