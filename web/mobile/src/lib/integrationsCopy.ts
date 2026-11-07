import type {TranslationKey} from "@agenta/i18n"
import {t, type useT} from "@agenta/i18n/navigation"
import {
    getSettingsTabDescription,
    getSettingsTabDocs,
    getSettingsTabLabel,
    type SettingsAccess,
    type SettingsTabDocs,
    type SettingsTabKey,
} from "@agenta/settings"

/** This app says "Integrations" where the shared copy says "Tools", which oss/ee still use. */
const TAB_LABELS: Partial<Record<SettingsTabKey, TranslationKey<"navigation">>> = {
    tools: "navigation.settings.integrationsLabel",
}

const TAB_DESCRIPTIONS: Partial<Record<SettingsTabKey, TranslationKey<"navigation">>> = {
    tools: "navigation.settings.integrationsDescription",
}

const TAB_DOCS_LABELS: Partial<Record<SettingsTabKey, TranslationKey<"navigation">>> = {
    tools: "navigation.settings.integrationsDocs",
}

const relabel = (key: TranslationKey<"navigation"> | undefined) => (key ? t(key) : undefined)

export const getMobileSettingsTabLabel = (key: SettingsTabKey, access: SettingsAccess) =>
    relabel(TAB_LABELS[key]) ?? getSettingsTabLabel(key, access)

export const getMobileSettingsTabDescription = (key: SettingsTabKey, access: SettingsAccess) =>
    relabel(TAB_DESCRIPTIONS[key]) ?? getSettingsTabDescription(key, access)

export const getMobileSettingsTabDocs = (key: SettingsTabKey): SettingsTabDocs | undefined => {
    const docs = getSettingsTabDocs(key)
    const label = relabel(TAB_DOCS_LABELS[key])
    return docs && label ? {...docs, label} : docs
}

type Translate = ReturnType<typeof useT>

/** Relabels sidebar/rail entries in place, so both nav surfaces read the same as the page. */
export const withMobileSettingsLabels = <T extends {key: SettingsTabKey; title: string}>(
    tabs: T[],
    translate: Translate = t,
): T[] =>
    tabs.map((tab) => {
        const key = TAB_LABELS[tab.key]
        return key ? {...tab, title: translate(key)} : tab
    })
