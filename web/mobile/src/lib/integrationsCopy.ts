import {
    getSettingsTabDescription,
    getSettingsTabDocs,
    getSettingsTabLabel,
    type SettingsAccess,
    type SettingsTabDocs,
    type SettingsTabKey,
} from "@agenta/settings"

/** This app says "Integrations" where the shared copy says "Tools", which oss/ee still use. */
const TAB_LABELS: Partial<Record<SettingsTabKey, string>> = {
    tools: "Integrations",
}

const TAB_DESCRIPTIONS: Partial<Record<SettingsTabKey, string>> = {
    tools: "Connect the integrations your agents can use.",
}

const TAB_DOCS_LABELS: Partial<Record<SettingsTabKey, string>> = {
    tools: "About integrations",
}

export const getMobileSettingsTabLabel = (key: SettingsTabKey, access: SettingsAccess) =>
    TAB_LABELS[key] ?? getSettingsTabLabel(key, access)

export const getMobileSettingsTabDescription = (key: SettingsTabKey, access: SettingsAccess) =>
    TAB_DESCRIPTIONS[key] ?? getSettingsTabDescription(key, access)

export const getMobileSettingsTabDocs = (key: SettingsTabKey): SettingsTabDocs | undefined => {
    const docs = getSettingsTabDocs(key)
    const label = TAB_DOCS_LABELS[key]
    return docs && label ? {...docs, label} : docs
}

/** Relabels sidebar/rail entries in place, so both nav surfaces read the same as the page. */
export const withMobileSettingsLabels = <T extends {key: SettingsTabKey; title: string}>(
    tabs: T[],
): T[] => tabs.map((tab) => (TAB_LABELS[tab.key] ? {...tab, title: TAB_LABELS[tab.key]!} : tab))

/** Copy for the shared `GatewayToolsSection`, whose defaults still say "tool" for oss/ee. */
export const INTEGRATIONS_SECTION_COPY = {
    integrationColumn: "Integration",
    run: "Run action",
    searchPlaceholder: "Search integrations",
    connect: "Connect integration",
    emptyTitle: "No integrations connected yet",
    emptyBody: "Connect an integration to let your agents call it.",
    noMatch: (term: string) => `No integrations match “${term}”`,
} as const
