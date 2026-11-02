import {memo} from "react"

import type {SettingsTabKey} from "@agenta/settings"

import {SETTINGS_TAB_COMPONENTS} from "./settingsTabRegistry"

/** The open tab's body. Memoized so a route or theme change elsewhere does not re-render it. */
export const SettingsTabContent = memo(function SettingsTabContent({
    tab,
    workspaceId,
    projectId,
}: {
    tab: SettingsTabKey
    workspaceId: string
    projectId: string
}) {
    const Tab = SETTINGS_TAB_COMPONENTS[tab]
    return Tab ? <Tab workspaceId={workspaceId} projectId={projectId} /> : null
})
