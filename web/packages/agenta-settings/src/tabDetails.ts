import {createT} from "@agenta/i18n"
import settingsTabsCatalog from "@agenta/i18n/catalogs/settingsTabs"

import {
    SETTINGS_TABS,
    type SettingsAccess,
    type SettingsTabDocs,
    type SettingsTabKey,
} from "./navigation"

// Its own module and catalog: only a settings page shows these, not the app shell.
const t = createT(settingsTabsCatalog)

export const getSettingsTabDescription = (key: SettingsTabKey, access: SettingsAccess): string => {
    const tab = SETTINGS_TABS.find((item) => item.key === key)
    if (!tab) return ""
    return t(tab.getDescriptionKey ? tab.getDescriptionKey(access) : tab.descriptionKey)
}

export const getSettingsTabDocs = (key: SettingsTabKey): SettingsTabDocs | undefined => {
    const docs = SETTINGS_TABS.find((item) => item.key === key)?.docs
    return docs && {label: t(docs.labelKey), href: docs.href}
}
