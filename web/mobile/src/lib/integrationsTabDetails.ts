import {createT, type CatalogKey} from "@agenta/i18n"
import settingsTabsCatalog from "@agenta/i18n/catalogs/settingsTabs"
import {
    getSettingsTabDescription,
    getSettingsTabDocs,
    type SettingsAccess,
    type SettingsTabDocs,
    type SettingsTabKey,
} from "@agenta/settings"

// Only the settings page reads these, so they stay out of the app shell's integrationsCopy.
const t = createT(settingsTabsCatalog)

type TabTextKey = CatalogKey<typeof settingsTabsCatalog>

/** This app says "integrations" where the shared copy says "tools", which oss/ee still use. */
const TAB_DESCRIPTIONS: Partial<Record<SettingsTabKey, TabTextKey>> = {
    tools: "settingsTabs.integrationsDescription",
}

const TAB_DOCS_LABELS: Partial<Record<SettingsTabKey, TabTextKey>> = {
    tools: "settingsTabs.integrationsDocs",
}

export const getMobileSettingsTabDescription = (key: SettingsTabKey, access: SettingsAccess) => {
    const override = TAB_DESCRIPTIONS[key]
    return override ? t(override) : getSettingsTabDescription(key, access)
}

export const getMobileSettingsTabDocs = (key: SettingsTabKey): SettingsTabDocs | undefined => {
    const docs = getSettingsTabDocs(key)
    const label = TAB_DOCS_LABELS[key]
    return docs && label ? {...docs, label: t(label)} : docs
}
