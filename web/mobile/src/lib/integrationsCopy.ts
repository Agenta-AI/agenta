import {
    getSettingsTabDescription,
    getSettingsTabDocs,
    getSettingsTabLabel,
    type SettingsAccess,
    type SettingsTabDocs,
    type SettingsTabKey,
} from "@agenta/settings"

/**
 * This app calls the gateway-tool surface "Integrations", not "Tools" — the row a user connects
 * is Gmail or Slack, not a single callable function, and "tool" collides with the tool CALLS a
 * transcript shows. The shared `@agenta/settings` copy still says "Tools" for oss/ee, so the
 * rename lives here rather than in the package: flip these tables into `navigation.ts` the day
 * the desktop renames too.
 */
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

/** Copy for the agent overview's config card, whose tools row says "Tools" for oss/ee. */
export const AGENT_CONFIG_INTEGRATIONS_COPY = {
    toolsTitle: "Integrations",
    toolsCount: (count: number) => `${count} enabled`,
    toolsAdd: "Add integrations",
    toolsNone: "None enabled",
} as const
